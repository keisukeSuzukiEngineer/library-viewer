const { createApp } = Vue;

Vue.createApp({
  data() {
    return {
      // 検索パネル用
      lastScrollY: 0,
      searchText: "",
      matched_words_isbns: [],
      query_panel:{
        is_loading: true,
        offset_y: 0,
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

      // 詳細表示用
      show_isbn: null,
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
      if (!this.tagsOrders || !this.tagsOrders.selected || this.tagsOrders.selected.length <= 0) return []
      
      const isbns = new Set(
        this.tagsOrders.selected
          .flatMap(token => [...this.tagsOrders.indexs[token]] || [])
      );
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
      if(this.matched_words_isbns.length > 0){
        isbns = isbns.filter(isbn => this.token_match_isbns.has(isbn));
      }
      // console.log("tokened isbns.length: ", isbns.length)
      if(isbns.length == 0)return isbns
      
      // console.log(this.tag_match_isbns)
      if(this.tag_match_isbns.size > 0){
        isbns = isbns.filter(isbn => this.tag_match_isbns.has(isbn));
      }
      // console.log("taged isbns.length: ", isbns.length)
      if(isbns.length == 0)return isbns
      
      return isbns;
    },
    
    // 検索パネル表示関係
    query_panel_style(){
        return {
            transform: `translateY(-${this.query_panel.offset_y}px)`
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
    token_results(){
      // console.log("call token_results")
      if(!this.matched_words_isbns)return [];
      // console.log(this.matched_words_isbns)
      return this.matched_words_isbns
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
    },
      
    // 詳細画面関係
    detail_panel_layer_class(){
      return {
        "open": this.show_isbn,
      }
    },
    book_detail(){
        const book = this.booksByIsbn[this.show_isbn].record;
        
        let ndc = book['ndc']
        if(this.ndc_codes){
          const record = this.ndc_codes[ndc.split(".")[0]]
          console.log(record)
          if(record){
            ndc += `:${record['ndc'+book.ndc_version+'_name']}`
          }
        }
        
        // booksByIsbnの汚染を防ぐため、bookを直接編集することはしない
        return {
          ...book,
          'ndc': ndc,
        }
    }
  },
  async mounted() {
    this.standby_observer();
    this.set_events();
    await this.loadIndex();
    await this.loadSorts(def_only=true);
    this.query_pane_open();
    this.change_search_text(); // 基本不要だが、js側で初めから検索テキストを設定していた場合に必要
  },

  methods: {
    // 要素へのイベント設定用
    set_events(){
      window.addEventListener(
      "scroll",
      () => {
          crrScroolY = window.scrollY;
          if(crrScroolY < 0 || document.documentElement.scrollHeight < crrScroolY)return;
          this.query_panel.offset_y = Math.max(
            0,
            Math.min(
              this.query_panel.offset_y + crrScroolY - this.lastScrollY,
              this.$refs.query_panel.getBoundingClientRect().height
            )
          )
          // console.log(this.query_panel.offset_y)
          this.lastScrollY = crrScroolY;
        }, 
        { passive: true }
      );
    },
    
    // 検索表示用データ読み込み系
    async loadIndex(){
      // console.log("call loadIndex")
      this.index = await fetch("json/index.json").then(r => r.json());
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
      const sortedIndex = await fetch(this.index.sorted_inex).then(r => r.json());
      // console.log(this.sortedIndex)
      
      const def_key = sortedIndex.default_key;
      // console.log(def_key, this.sortedIndex.indexs[def_key])
      // console.log({
            // def_key: this.sortedIndex.indexs[def_key]
        // })
      this.sortOrders = {
        "key": def_key,
        "order": sortedIndex.default_order,
        "key_select": Object
          .entries(sortedIndex.indexs)
          .filter(itm => itm[0] == def_key || !def_only)
          .map(itm => ({"val" : itm[1].sort_key, "label": itm[1].sort_label})),
        "order_select": [{"label": "昇順", "val": "asc"}, {"label": "降順", "val": "desc"}],
        "indexs": await this.loadAllPagesParallel(
            Object
            .entries(sortedIndex.indexs)
            .filter(itm => itm[0] == def_key || !def_only)
            .reduce((acc, cur) => {
              acc[cur[0]] = cur[1];
              return acc;
            }, {})
        ),
        "def_only": def_only
      }
    },
    async loadTokens(){
      // console.log("call loadTokens")
      if(this.tokenOrders){
        // console.log("skip loadTokens")
        this.loadAnarizer();
        return
      }
      
      this.tokenIndex = await fetch(this.index.token_index).then(r => r.json());
      const indexScores = await this.loadAllPagesParallel(this.tokenIndex.indexs)
      // console.log(indexScores)
      // console.log(indexScores['tokens'][0])
      this.tokenOrders = {
        "indexs": Object.fromEntries(
          Object.entries(indexScores.tokens).map(([key, valueDict]) => [
            valueDict.token,
            new Set(Object.entries(valueDict.isbns).map(itm => itm[0]))
          ])
        ),
        "indexScores": Object.fromEntries(
          Object.entries(indexScores.tokens)
          .map(([key, valueDict]) => [valueDict.token, valueDict.isbns])
        )
      }
      
      this.loadAnarizer();
    },
    async loadTags(){
      // console.log("call loadTags")
      if(this.tokenOrders)return
      
      const tagsIndex = await fetch(this.index.tags_index).then(r => r.json());
      this.tagsOrders = {
        "selected": [],
        // "selected": ["100"],
        "indexs": await this.loadAllPagesParallel(tagsIndex.indexs)
      }
    },
    loadAnarizer() {
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
      // console.log(has_char)
      // console.log(has_char['あ'])
      // console.log(this.tokenOrders.indexScores)
      // console.log(this.tokenOrders.indexScores[has_char['あ'][0]])
      // console.log([...has_char['あ']].map(word_char=>this.tokenOrders.indexScores[word_char]))
      this.trie.has_char = has_char;
    },
    async loadAllPagesParallel(indexs, isbnIsSet = false) {
      const result = {};
      // console.log(indexs)
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
    },
    async loadBook(isbn) {
      if (this.booksByIsbn[isbn]) return;

      // プレースホルダ（即反映）
      this.$set
        ? this.$set(this.booksByIsbn, isbn, null)
        : (this.booksByIsbn[isbn] = null);

      const book = await fetch(`json/books/book_${isbn}.json`)
        .then(r => r.json());

      // 取れた瞬間に画面更新
      this.booksByIsbn[isbn] = book;
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
              this.loadBook(isbn);
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

    //検索用パネル操作用
    query_pane_open(){
      this.query_panel.is_loading = false;
    },
    click_token_result(token_result){
      // console.log("call click_token_result", token_result)
      // console.log(this.matched_words_isbns[0])
      const target_index = this.matched_words_isbns
      .findIndex(matched_word_isbns=>matched_word_isbns['token'] == token_result['token'])
      
      this.matched_words_isbns[target_index] = {
        ...this.matched_words_isbns[target_index],
        "disable": !this.matched_words_isbns[target_index]["disable"]
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
    async sort_setting(){
      // console.log("call sort_setting")
      this.query_panel.sort_editor.stat = "loading"
      
      await this.loadSorts()
          
      this.query_panel.sort_editor.stat = "standby"
    },
    async text_panel_setting(){
      // console.log("call sort_setting")
      this.query_panel.text_panel.stat = "loading"
          
      await this.loadTokens()
          
      this.query_panel.text_panel.stat = "standby"
    },
    
    //詳細表示パネル操作用
    show_reset(){
      this.show_isbn = null;
      
    },
    show_detail(isbn){
      this.show_isbn = isbn
      this.load_ndc_code()
    },
    
    // 編集機能への連携用
    open_notion(page_id){
      window.open("https://www.notion.so/"+page_id.replace(/\_/g, "").replace(/-/g, ""), '_blank')
    },
  }
}).mount("#app");

function set_and_merge(sets){
  const [first_set, ...rest_sets] = sets.sort((a, b) => a.size - b.size);
  
  // console.log(first_isbns)
  const merged_set = rest_sets
    .reduce(
      (base_set, rest_set)=>new Set([...base_set].filter(itm => rest_set.has(itm))),
      first_set || new Set()
    )
  
  return merged_set
}