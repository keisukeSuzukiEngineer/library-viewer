const { createApp } = Vue;

const params = Object.fromEntries(new URLSearchParams(window.location.search));


function set_and_merge(sets){
  // console.log(sets)
  const [first_set, ...rest_sets] = sets.sort((a, b) => a.size - b.size);
  
  // console.log(first_isbns)
  const merged_set = rest_sets
    .reduce(
      (base_set, rest_set)=>new Set([...base_set].filter(itm => rest_set.has(itm))),
      first_set || new Set()
    )
  
  return merged_set
}
async function loadAllPagesParallel(indexs, isbnIsSet = false) {
    const result = {};
    console.log(indexs)
    await Promise.all(
      Object.entries(indexs).map(async ([key, info]) => {
        const pagesData = await Promise.all(
          info.pages.map(p => fetch(p).then(r => r.json()))
        );

        // 🔽 ここで加工
        const isbns = pagesData.flatMap(p => p.isbns);

        result[key] = isbnIsSet
          ? new Set(isbns)
          : isbns;
      })
    );


    return result;
}
  
function debounce(fn, delay) {
    let timer
    return function (...args) {
      clearTimeout(timer)
      timer = setTimeout(() => fn.apply(this, args), delay)
    }
}

class FetchManager {
  constructor({ concurrency = 5, retry = 1 , categories = []} = {}) {
    this.concurrency = concurrency
    this.retry = retry

    this.categories = [...categories, null];
    this.categorySet = new Set(categories)
    this.queue = Object.fromEntries(
      this.categories
      .map(k => [k, []])
    )
    this.running = new Map()

    this.cache = new Map()
    this.inFlight = new Map()
    this.controllers = new Map()
  }

  request({ url, priority = 0 , category = null}) {
    return new Promise((resolve, reject) => {
      
      // キャッシュ
      if (this.cache.has(url)) {
        resolve(this.cache.get(url))
        return
      }

      // 重複
      if (this.inFlight.has(url)) {
        this.inFlight.get(url).push({ resolve, reject })
        return
      }

      this.inFlight.set(url, [{ resolve, reject }])
      
      const tuned_category = this.categorySet.has(category) ? category : null;

      this.queue[tuned_category].push({
          url, 
          priority, 
          category: tuned_category, 
          retry: this.retry 
      });
      this.queue[tuned_category]._dirty = true;
      
      if(tuned_category == "books"){
          // booksの場合はpriorityにelを入れておき、毎度fetchの直前に描画位置をもとにソートする
      }
      else{
      }

      this._run()
    })
  }

  async _run() {
    if (this.running.size >= this.concurrency) return

    const tasks = (() => {
      for (const category of this.categories) {
        if (this.queue[category].length > 0) {
          return this.queue[category]
        }
      }
      return null
    })();
    if (!tasks) return
    
    
    if(tasks[0]?.category == "books"){
        // booksの場合はpriorityにelを入れておき、毎度fetchの直前に描画位置をもとにソートする
        tasks.forEach(item => {
          const rect = item.priority.getBoundingClientRect()

          let y = rect.top
          if (y < 0) y += 100000

          item._y = y
          item._x = rect.left
        })
        tasks.sort((a, b) => {
          if (a._y !== b._y) return a._y - b._y
          return a._x - b._x
        })
    }
    else if(tasks._dirty){
        tasks.sort((a, b) => b.priority - a.priority);
        tasks._dirty = false;
    }
  
    const task = tasks.shift()
    
    const { url } = task;

    this.running.set(url, true)

    const controller = new AbortController()
    this.controllers.set(url, controller)

    try {
      const res = await fetch(url, { signal: controller.signal })
      
      const data = await(async() => {
          const contentType = res.headers.get("content-type") || "";
          const text = await res.text();
          
          // JSON
          if (contentType.includes("application/json")) {
            return JSON.parse(text);
          }

          // CSV
          if (contentType.includes("text/csv") || url.endsWith(".csv")) {
            return parseCSV(text);
          }
          
          return text;
      })();

      this.cache.set(url, data)

      const callbacks = this.inFlight.get(url) || []
      callbacks.forEach(cb => cb.resolve(data))

    } catch (e) {
      if (task.retry > 0) {
        task.retry--
        tasks.push(task)
        tasks._dirty = false;
      } else {
        const callbacks = this.inFlight.get(url) || []
        callbacks.forEach(cb => cb.reject(e))
      }
    } finally {
      this.inFlight.delete(url)
      this.running.delete(url)
      this.controllers.delete(url)

      // イベントループ戻す（重要）
      await Promise.resolve()

      this._run()
    }
  }

  abort(url) {
    const controller = this.controllers.get(url)
    if (controller) {
      controller.abort()
      this.controllers.delete(url)
    }
  }

  clearCache() {
    this.cache.clear()
  }
}
const fetchManager = new FetchManager({
    concurrency: 10,
    retry: 1 ,
    categories: ["books", "index"]
    
});
// console.log(params)

const CompA = {
  template: `
    <div>
      <input v-model="text" @input="emitValue" placeholder="検索">
    </div>
  `,
  data() {
    return { text: "" }
  },
  methods: {
    emitValue() {
      this.$emit("update", this.text)
    }
  }
}

// cssで指定した値
const bookRect = {
  height: 165,
  width: 90
}

Vue.createApp({
  data() {
    return {
      logs: [],
      params: params,
      // 検索パネル用
      // lastScrollY: 0,
      searchText: "",
      tagText:"",
      matched_words_isbns: [],
      matched_tags_isbns: [],
      query_panel:{
        is_open: false,
        // offset_y: 0,
        sort_editor:{
          stat: "wait",
          class:{
            wait: true,
            loading:false,
            standby:false
          }
        },
        text_panel:{
          stat: "wait",
          class:{
            wait: true,
            loading:false,
            standby:false
          }
        },
        tab_panel:{
          stat: "wait",
          class:{
            wait: true,
            loading:false,
            standby:false
          }
        }
      },
      // detail_panel_layer_class: {
        // "open": false
      // },
      
      //表示検索用データ関係
      observer:null,
      index: null,
      sortOrders: null,
      tagsOrders: null,
      tokenOrders: null,
      trie:{
        root:null,
        has_char:null,
      },
      booksByIsbn: {},
      booklet: {
        book_x_num: 3, // 画面サイズで動的に変化する列数
        book_y_num: 5, // 画面サイズで動的に変化する行数(スクロールバッファ含む)
        book_y_buff: 2, // 画面サイズで動的に変化する行数(スクロールバッファ含む)
        book_num: 21, // 画面サイズで動的に変化する一度に表示する冊数
        top_orver_book_row: 0, 
        is_slide_bottom: false,
        style: {
          height: (bookRect.height*7)+"px",
          "marginTop": "0",
        }
      },

      // 詳細表示用
      show_isbn: null,
      detail_open: false,
      ndc_codes: null,
    };
  },

  computed: {
    // 表示用isbn作成関係
    sort_match_isbns(){
      // console.log("call sort_match_isbns")
      if(!this.sortOrders || !this.sortOrders.key)return []
      
      isbns = [...(this.sortOrders.indexs[this.sortOrders.key] || [])]
      
      if(this.sortOrders.order == "desc")isbns.reverse();
      
      return isbns;
    },
    token_match_isbns(){
      // console.log("call token_match_isbns")
        
      // //orバージョン
      // const isbns = new Set(
        // words
        // .flatMap(token => [...this.tokenOrders.indexs[token] || []])
      // );
      
      if(!this.matched_words_isbns)return [];
      // andバージョン  
      const isbns = set_and_merge(
          this.matched_words_isbns
          .filter(word_isbns=>{
              return Boolean(word_isbns['isbns']) && !word_isbns['disable']
          })
          .map(word_isbns=>word_isbns['isbns'])
        )
      return isbns;
      
    },
    tag_match_isbns(){
      if (!this.matched_tags_isbns) return []
      
      const isbns = set_and_merge(
          this.matched_tags_isbns
          .filter(tag_isbns=>{
              return Boolean(tag_isbns['isbns']) && tag_isbns['selected'] && !tag_isbns['disable']
          })
          .map(tag_isbns=>tag_isbns['isbns'])
        )
      // console.log("token isbns:", isbns)
      return isbns;
      
    },
    visibleIsbns(){
      // 1. 並び順（ISBN配列）
      // console.log("call visibleBooks")
      
      if(!this.sortOrders){
        // console.log("retuen visibleBooks prev_load_pattorn", Array(24).fill(""))
        
        return Array(12).fill("");
      }
      
      let isbns = this.sort_match_isbns
      // console.log("sorted isbns.length: ", isbns.length)
      if(isbns.length == 0)return isbns
      
      // console.log("this.token_match_isbns: ", this.token_match_isbns)
      if(this.token_match_isbns.size > 0){
        isbns = isbns.filter(isbn => this.token_match_isbns.has(isbn));
      }
      // console.log("tokened isbns.length: ", isbns.length)
      if(isbns.length == 0)return isbns
      
      // console.log("this.tag_match_isbns", this.tag_match_isbns)
      if(this.tag_match_isbns.size > 0){
        isbns = isbns.filter(isbn => this.tag_match_isbns.has(isbn));
      }
      // console.log("taged isbns.length: ", isbns.length)
      if(isbns.length == 0)return isbns
      
      return isbns;
    },
    bookletStyle(){
        // console.log(
          // this.booklet.book_y_num+this.booklet.book_y_buff, "-", 
          // this.visibleIsbns.length , 
          // this.booklet.book_x_num,
          // Math.ceil(this.visibleIsbns.length / this.booklet.book_x_num),
          // this.visibleIsbns[0],
          // this.visibleIsbns.at(-1)
        // )
        return {
          // heightは画面内に表示しきれる場合と、表示しきれない場合両方を想定
          'height': bookRect.height*Math.min(
            this.booklet.book_y_num+this.booklet.book_y_buff, 
            Math.ceil(this.visibleIsbns.length / this.booklet.book_x_num)
          )+"px",
          "marginTop": (Math.max(this.booklet.top_orver_book_row - 1, 0)*bookRect.height)+"px"
        }
    },
    bookletSupporterStyle(){
        // console.log(this.visibleIsbns.length, this.booklet.book_x_num, this.visibleIsbns.length / this.booklet.book_x_num)
        return {
          'height': (bookRect.height*Math.ceil(this.visibleIsbns.length / this.booklet.book_x_num))+"px",
        }
    },
    slicedVisibleIsbns(){   
      const offset = Math.max(this.booklet.top_orver_book_row - 1, 0) * this.booklet.book_x_num;   
      console.log(this.visibleIsbns.length, offset, this.visibleIsbns.at(0), this.visibleIsbns.at(-1))
      return this.visibleIsbns.slice(offset, offset + this.booklet.book_num);
    },
    
    books(){
      return this.slicedVisibleIsbns.map(isbn=>this.booksByIsbn[isbn]??{record:{isbn:isbn}})
    },
    
    // 検索パネル表示関係
    query_layer_class(){
        return {
            open: this.query_panel.is_open
        }
    },
    sort_editor_class(){
      const stat = this.query_panel.sort_editor.stat
      return {
          wait: stat == "wait",
          loading:stat == "loading",
          standby:stat == "standby"
      }
    },
    sort_editor_select_class(){
      return {
          'transparent': this.query_panel.sort_editor.stat != "standby",
          'activate': this.query_panel.sort_editor.stat == "standby",
      }
    },
    text_panel_input_class(){
      return {
          'transparent': this.query_panel.text_panel.stat != "standby"
      }
    },
    text_panel_class(){
      const stat = this.query_panel.text_panel.stat
      return {
          wait: stat == "wait",
          loading:stat == "loading",
          standby:stat == "standby"
      }
    },
    tag_panel_class(){
      const stat = this.query_panel.tab_panel.stat
      return {
          wait: stat == "wait",
          loading:stat == "loading",
          standby:stat == "standby"
      }
    },
    token_results(){
      // console.log("call token_results", !this.matched_tags_isbns)
      if(!this.matched_tags_isbns && !this.matched_words_isbns)return [];
      // console.log(this.matched_words_isbns)
      console.log()
      tabs = [
        
        ...this.matched_tags_isbns
        .filter(tag_isbns=>{
            return Boolean(tag_isbns['isbns'] && tag_isbns['selected'])
        })
        .map(tag_isbns=>{
          return {
            "tag": tag_isbns['tag'],
            "text": `${tag_isbns['tag']}: ${tag_isbns['isbns'].size}`,
            "class":{
              "token_result": true,
              "disable": tag_isbns.disable
            }
          
          }
        }),
        
        ...this.matched_words_isbns
        .map(word_isbns=>{
          return {
            "token": word_isbns['token'],
            "text": `${word_isbns['token']}: ${word_isbns['isbns'].size}`,
            "class":{
              "token_result": true,
              "disable": word_isbns.disable
            }
          
          }
        })
      ]
      // console.log(tabs)
      return tabs
    },
    
    //本棚関連
    booklet_class(){
      return {
        "slide_bottom": this.booklet.is_slide_bottom
      }
    },
      
    // 詳細画面関係
    detail_panel_layer_class(){
      return {
        "open": this.detail_open,
      }
    },
    book_detail(){
        if(!this.show_isbn)return {}
        const book = this.booksByIsbn[this.show_isbn].record;
        
        let ndc = book['ndc']
        if(this.ndc_codes){
          const record = this.ndc_codes[ndc.split(".")[0]]
          // console.log(record, book.ndc_version)
          if(record){
            // console.log(record, book.ndc_version)
            ndc += `:${record['ndc'+book.ndc_version+'_name']}`
          }
        }
        return {
          ...book,
          'ndc': ndc,
        }
    }
  },
  async mounted() {
    this.standby_observer();
    this.set_events();
    this.refresh_booklet_size();
    // await this.loadIndex();
    // await this.loadSorts(def_only=true);
    // this.change_search_text(); // 基本不要だが、js側で初めから検索テキストを設定していた場合に必要
    
    
    requestAnimationFrame(() => {
        this.initAsync(); 
    });
  },
  
  watch:{
      searchText: debounce(function () {
        this.change_search_text()
      }, 500),
      tagText: debounce(function () {
        this.change_tag_text()
      }, 500),
  },

  methods: {
    async initAsync() {
      await this.loadIndex()
      // await this.loadSorts(true)
      this.change_search_text()// 基本不要だが、js側で初めから検索テキストを設定していた場合に必要
    },
    // 要素へのイベント設定用
    set_events(){
      window.addEventListener("scroll", this.query_pane_close, { passive: true });
      this.$refs.bookletLayer.addEventListener("scroll", this.query_pane_close, { passive: true });
      this.$refs.bookletLayer.addEventListener("scroll", this.refresh_top_orver_book_row);
      window.addEventListener("resize", this.refresh_booklet_size)
    },
    query_pane_close(){
      let isInputFocused = false
      if (document.activeElement.tagName === 'TEXTAREA' || document.activeElement.tagName === 'INPUT') {
        isInputFocused = true;
      }
      this.add_logs(`isInputFocused:${isInputFocused}`)
      if(!isInputFocused)this.query_pane_close()
    },
    refresh_top_orver_book_row(){
        // const el = this.$refs.booklet
        // if (!el) return
        
        const parent_y = this.$refs.bookletLayer.getBoundingClientRect().top
        const support_y = this.$refs.bookletScrollSupporter.getBoundingClientRect().top
        const bootlet_y = parent_y - support_y;
        this.booklet.top_orver_book_row = Math.min(
          // スクロール中の位置
          Math.floor(bootlet_y / bookRect.height), 
          
          // 最後までスクロールしきった場合(これがあることで夢幻スクロールを回避)
          Math.ceil(this.visibleIsbns.length / this.booklet.book_x_num) - this.booklet.book_y_num - 1
        );
        console.log(
          bootlet_y, bookRect.height, Math.floor(bootlet_y / bookRect.height), ", ",
          this.visibleIsbns.length, this.booklet.book_x_num, Math.ceil(this.visibleIsbns.length / this.booklet.book_x_num), 
          this.booklet.top_orver_book_row
        )
    },
    refresh_booklet_size(){
      const layerRect = this.$refs.bookletLayer.getBoundingClientRect()
      console.log(this.$refs)
      const children = this.$refs.booklet.children
      const firstTop = children[0]?.offsetTop ?? 0

      let colCount = 0
      for (const el of children) {
        if (el.offsetTop !== firstTop) break
        colCount++
      }
      this.booklet.book_x_num = colCount
      this.booklet.book_y_num = Math.floor(layerRect.height / bookRect.height)
      this.booklet.book_num = this.booklet.book_x_num * (this.booklet.book_y_num + this.booklet.book_y_buff)
    },
    
    // 検索表示用データ読み込み系
    async loadIndex(){
      // console.log("call loadIndex")
      this.index = await fetch("json/index.json").then(r => r.json());
      
      fetchManager.request({
        url:"json/index.json",
        priority: 10
      })
      .then(data => {
          this.index = data;
          this.loadSorts(true);
      })
    },
    async loadSorts(def_only = false){
      // console.log("call loadFirstSort")
      if(
        this.sortOrders &&
        !this.sortOrders.def_only
      ){
        // console.log("skip loadSorts")
        return;
      }
      
      fetchManager.request({
        url:this.index.sorted_inex,
        priority: 0,
        category: "index"
      })
      .then(sorted_inex => Promise.all(
          Object.entries(sorted_inex.indexs)
          .filter(itm => itm[0] == sorted_inex.default_key || !def_only)
          .map(itm => 
            Promise.all(
              itm[1].pages.map(url=>
                fetchManager.request({
                  url,
                  category: "index"
                })
              )
            )
            .then(results=>[itm[0], results.map(result => result.isbns).flat()])
          )
        ).then(result => {
          this.sortOrders = {
            "key": sorted_inex.default_key,
            "order": sorted_inex.default_order,
            "key_select": Object.entries(sorted_inex.indexs)
              .filter(itm => itm[0] == sorted_inex.default_key || !def_only)
              .map(itm => ({"val" : itm[1].sort_key, "label": itm[1].sort_label})),
            "order_select": [{"label": "昇順", "val": "asc"}, {"label": "降順", "val": "desc"}],
            "indexs": Object.fromEntries(result),
            "def_only": def_only
          }
        })
      )
    },
    async loadTokens(calback = null){
      
      if(this.tokenOrders){
        this.loadTextAnarizer();
        return
      }
      
      fetchManager.request({
        url:this.index.token_index,
        priority: 0,
        category: "index"
      })
      .then(tokenIndex => 
        Promise.all(
          tokenIndex.indexs.tokens.pages.map(token_page_url => 
              fetchManager.request({
                url: token_page_url,
                category: "index"
              })
          )
        )
        .then(result =>{
          const indexScores = result.map(r => r.isbns).flat();
          
          this.tokenOrders = {
            "indexs": Object.fromEntries(
              indexScores.map(itm => [
                itm.token,
                new Set(Object.entries(itm.isbns).map(itm => itm[0]))
              ])
            ),
            "indexScores": Object.fromEntries(
              indexScores
              .map(itm => [itm.token, itm.isbns])
            )
          }
          
          this.loadTextAnarizer();
          if(calback)calback();
        })
      );
    },
    async loadTags(callback = null){
      // console.log("call loadTags")
      if(this.tokenOrders)return
      
      fetchManager.request({
        url:this.index.tags_index,
        priority: 0,
        category: "index"
      })
      .then(tags_index => 
        Promise.all(
            Object.entries(tags_index.indexs).map(itm => 
              Promise.all(itm[1].pages.map(url => 
                  fetchManager.request({
                    url,
                    category: "index"
                  })
              )
            )
            .then(results => [itm[0], new Set(results.map(itm => itm.isbns).flat())])
          )
        )
        .then(result =>{
           this.tagsOrders = {
              "selected": [],
              // "selected": ["100"],
              "indexs": Object.fromEntries(result)
            }
          
            this.loadTagAnalyzer();
            if(callback)callback();
        }))
    },
    loadTextAnarizer() {
      // console.log("call loadAnarizer", this.trie)
      if(this.trie.has_char){
        // console.log("skip loadAnarizer")
        return
      }
      
      // chat gptで出てきたTrie方式
      const root = {}

      for (const word of Object.keys(this.tokenOrders.indexs)) {
        let node = root

        for (const char of word) {
          if (!node[char]) node[char] = {}
          node = node[char]
        }

        node.$ = true
      }

      // console.log(root)
      
      this.trie.root = root;
      
      //特定後の文字を含む単語の一覧
      const has_char = {}
      for (const word of Object.keys(this.tokenOrders.indexs).filter(word=>word.length >1)) {
        // console.log(word)
        for (const word_char of word) {
          if(!this.tokenOrders.indexs[word_char]){
              has_char[word_char] ||= new Set();
              has_char[word_char].add(word)
          }
        }
      }
      this.trie.has_char = has_char;
    },
    loadTagAnalyzer(){
      if(this.trie.has_tag_char){
        // console.log("skip loadAnarizer")
        return
      }
      
      //特定後の文字を含む単語の一覧
      const has_char = {}
      for (const word of Object.keys(this.tagsOrders.indexs)) {
        // console.log(word)
        for (const word_char of word) {
            has_char[word_char] ||= new Set();
            has_char[word_char].add(word)
        }
      }
      this.trie.has_tag_char = has_char;
    },
    async loadBook(isbn, entry) {
      if (this.booksByIsbn[isbn]) return;

      // プレースホルダ（即反映）
      this.$set
        ? this.$set(this.booksByIsbn, isbn, null)
        : (this.booksByIsbn[isbn] = null);

      fetchManager.request({
        url:`json/books/book_${isbn}.json`,
        priority: entry.target,
        category: "books"
      })
      .then(book => {
        this.booksByIsbn[isbn] = {
          ...book,
          stat: "loaded"
        };
      })
    },
    set_book_stat(isbn){
      this.booksByIsbn[isbn] = {
        ...this.booksByIsbn[isbn],
        stat: 'imgLoaded'
      }
    },
    registerBookEl(isbn, el) {
      if (!el) return;
      el.dataset.isbn = isbn;
      this.observer.observe(el);
    },
    standby_observer(){
      if(this.observer)return
      this.observer = new IntersectionObserver(
        entries => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              const isbn = entry.target.dataset.isbn;
              this.loadBook(isbn, entry);
              this.observer.unobserve(entry.target);
            }
          }
        },
        {
          root: null,
          rootMargin: '300px', // ←「もうすぐ描画されそう」
          threshold: 0,
        }
      );
    },
    register_observe(el){
      // console.log(this.$refs)
      // this.$refs.bookEls.forEach(el => {
        // this.observer.observe(el);
      // });
      // console.log(el, this.observer.observe)
      if(!el || !el.dataset.isbn || !this.observer){
        // console.log(el, this.observer)
        return;
      }
      this.observer.observe(el);
    },
    async load_ndc_code(){
      
      if(this.ndc_codes)return
          
      const res = await fetch(this.index.ndc_codes);
      const text = await res.text();

      const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
      const headers = lines[0].split(",");

      const data = lines.slice(1).map(line => {
        const values = line.split(",");
        const obj = {};
        headers.forEach((h, i) => {
          obj[h] = values[i];
        });
        return obj;
      });

      this.ndc_codes = data;
    },

    // 検索文字列の解析用
    match_words_search(orijin_text) {
      
      if(!this.trie.root || !this.trie.has_char || !orijin_text)return new Set(), new Set();
      
      
      const match_words = new Set()
      const un_match_results = []
      
      orijin_text.split(/[ 　]+/).forEach(text =>{
          
        let un_match_start = 0
        let i = 0
        for (; i < text.length; i++) {
          let node = this.trie.root
          let j = i
          let lastMatch = null
          let candidate = null

          while (node[text[j]]) {
            node = node[text[j]]
            j++

            candidate = text.slice(i, j)

            if (node.$) {
              lastMatch = candidate
            }
          }

          if (lastMatch) {
            match_words.add(lastMatch)
            
            // console.log(text.slice(un_match_start, i))
            if(un_match_start != i){
                un_match_results.push(text.slice(un_match_start, i))
            }

            i += lastMatch.length - 1
            un_match_start = i + 1
            
          }
        }
        // console.log(text.slice(un_match_start+1, i))
        if(un_match_start != i){
            un_match_results.push(text.slice(un_match_start, i))
        }
      })
      
      const candidate_words = un_match_results
      .map(text=> {
        const candidate_words = set_and_merge(
          text.split("")
          .map(text_char=>this.trie.has_char[text_char])
        )
        // console.log(text, "->", candidate_words)
        return candidate_words
      })
      .reduce((acc, set) => new Set([...acc, ...set]), new Set());

      // console.log(match_words, candidate_words)
      
      return [match_words, candidate_words]
    },
    
    //tagの検索用
    match_tags_search(orijin_text){
      
      if(!this.trie.has_tag_char || !orijin_text)return new Set()
        
      // console.log(orijin_text.split(""))
      tags = set_and_merge(
          orijin_text.split("")
          .map(text_char => this.trie.has_tag_char[text_char])
      )
      
      return tags
    },

    //検索用パネル操作用
    query_pane_close(){
      this.query_panel.is_open = false;
      this.booklet.is_slide_bottom = false;
    },
    query_pane_toggle(){
      this.query_panel.is_open = !this.query_panel.is_open;
      this.booklet.is_slide_bottom = !this.booklet.is_slide_bottom;
      
      this.sort_setting()
      this.text_panel_setting()
      this.tag_panel_setting()
    },
    click_token_result(token_result){
      // console.log("call click_token_result", token_result)
      // console.log(this.matched_words_isbns[0])
      if("token" in token_result){
        const target_index = this.matched_words_isbns
        .findIndex(matched_word_isbns=>matched_word_isbns['token'] == token_result['token'])
        
        this.matched_words_isbns[target_index] = {
          ...this.matched_words_isbns[target_index],
          "disable": !this.matched_words_isbns[target_index]["disable"]
        }
      }
      
      else if("tag" in token_result){
        const target_index = this.matched_tags_isbns
        .findIndex(matched_tag_isbns=>matched_tag_isbns['tag'] == token_result['tag'])
        
        this.matched_tags_isbns[target_index] = {
          ...this.matched_tags_isbns[target_index],
          "disable": !this.matched_tags_isbns[target_index]["disable"]
        }
      }
      
      // console.log(this.matched_words_isbns[0])
    },
    change_search_text(){
      const [match_words, candidate_words] = this.match_words_search(this.searchText);
      
      // console.log(this.searchText, "->", match_words, candidate_words)
        
      if(!match_words || !candidate_words || (match_words.length + candidate_words.length) <= 0){
        this.matched_words_isbns = []
        return
      }
      
      // console.log(match_words)
      const words_isbns = [
        ...[...match_words]
        .map(token => {
            return{
              "token":token, 
              "type": "match",
              "isbns":this.tokenOrders.indexs[token],
              "disable": false
            }
        }),
        ...[...candidate_words]
        .map(token => {
            return{
              "token":token, 
              "type": "candidate",
              "isbns":this.tokenOrders.indexs[token],
              "disable": true
            }
        })
      ]
      
      this.matched_words_isbns = words_isbns
    },
    change_tag_text(){
      const match_tags = this.match_tags_search(this.tagText);
      
      // console.log(this.searchText, "->", match_tags, candidate_words)
        
      if(!match_tags || match_tags.length  <= 0){
        this.matched_tags_isbns = []
        return
      }
      
      // console.log(match_tags)
      const tags_isbns = [...match_tags]
        .map(
          tag => {
            return {
              "tag": tag,
              "isbns": this.tagsOrders.indexs[tag],
              "selected": false, // 検索中の候補として出すlistで使う
              "disable": false, // 検索語のタブで使う
              "use_child": false
            }
          }
        )
      
      this.matched_tags_isbns = tags_isbns
    },
    click_tag_list(tag_isbns){
        console.log("call click_tag_list")
        tag_isbns['selected'] = !tag_isbns['selected']
    },
    async sort_setting(){
      // console.log("call sort_setting")
      if(this.query_panel.sort_editor.stat == "standby")return;
      
      this.query_panel.sort_editor.stat = "loading"
      
      await this.loadSorts()
          
      this.query_panel.sort_editor.stat = "standby"
    },
    async text_panel_setting(){
      // console.log("call sort_setting")
      if(this.query_panel.text_panel.stat == "standby")return;
      this.query_panel.text_panel.stat = "loading"
          
      await this.loadTokens(()=>this.query_panel.text_panel.stat = "standby")
    },
    async tag_panel_setting(){
      // console.log("call tag_setting")
      if(this.query_panel.tab_panel.stat == "standby")return;
      this.query_panel.text_panel.stat = "loading"
          
      await this.loadTags()
          
      this.query_panel.tab_panel.stat = "standby"
    },
    
    //詳細表示パネル操作用
    show_reset(){
      // console.log("call show_reset")
      const tmp_isbn = this.show_isbn;
      this.detail_open = false;
      setTimeout(() => {
        // 待機中にほかのisbnを表示していた場合を考慮
        if(tmp_isbn == this.show_isbn)this.show_isbn = null;
      }, 60);
    },
    show_detail(isbn){
      this.show_isbn = isbn
      this.detail_open = true
      this.load_ndc_code()
    },
    
    // 編集機能への連携用
    open_notion(page_id){
      window.open("https://www.notion.so/"+page_id.replace(/\_/g, "").replace(/-/g, ""), '_blank')
    },
    
    add_logs(log){
      this.logs.push(log);
      this.logs = this.logs.slice(0, 10)
    }
  }
}).mount("#app");