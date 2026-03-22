const { createApp } = Vue;

Vue.createApp({
  data() {
    return {
      
      lastScrollY: 0,
      
      query_panel:{
        is_loading: true,
        offset_y: 0,
      },
      
      searchText: "日　日常 神話　にゃー　世界　癌　日日本にゃー歴史癌",
      index: null,
      sortedIndex: null,
      sortOrders: {},
      tagsOrders: {},
      tokenOrders: {},
      kuromoji:{
        stat: "wait", // wait, loading, standby
        tokenizer: null,
        promise: null,
      },
      trie:{
        root:null,
      },
      matched_words_isbns: [],
      
      // 書籍実体
      booksByIsbn: {},

      // 現在の表示順（ISBN配列）
      orderedIsbns: [],
      
      show_isbn: null,
      detail_panel_layer_class: {
        "open": false
      },

      // ロード済みフラグ
      loadedPages: 0,
      pagePaths: []
    };
  },

  computed: {
    sort_match_isbns(){
      // console.log("call sort_match_isbns")
      if(!this.sortOrders || !this.sortOrders.key)return []
      return this.sortOrders.indexs[this.sortOrders.key] || [];
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
      if (!this.tagsOrders.selected || this.tagsOrders.selected.length <= 0) return []
      
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
    
    query_panel_style(){
        return {
            transform: `translateY(-${this.query_panel.offset_y}px)`
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
      }
  },
  async mounted() {
    this.set_events();
    await this.loadIndex();
    await this.loadFirstSort();
    this.set_observer();
    await this.loadSorts();
    await this.loadTokens();
    await this.loadTags();
    await this.loadAnarizer();
    this.change_search_text(); // 基本不要だが、側で初めから検索テキストを設定していた場合に必要
    this.query_pane_open();
  },

  methods: {
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
    async loadIndex(){
      // console.log("call loadIndex")
      this.index = await fetch("json/index.json").then(r => r.json());
    },
    async loadFirstSort(){
      // console.log("call loadFirstSort")
      this.sortedIndex = await fetch(this.index.sorted_inex).then(r => r.json());
      // console.log(this.sortedIndex)
      
      const def_key = this.sortedIndex.default_key;
      // console.log(def_key, this.sortedIndex.indexs[def_key])
      // console.log({
            // def_key: this.sortedIndex.indexs[def_key]
        // })
      this.sortOrders = {
        "key": def_key,
        "order": this.sortedIndex.default_order,
        "key_select": Object
          .entries(this.sortedIndex.indexs)
          .map(itm => ({"val" : itm[1].sort_key, "label": itm[1].sort_label})),
        "order_select": [{"label": "昇順", "val": "asc"}, {"label": "降順", "val": "desc"}],
        "indexs": await this.loadAllPagesParallel({
            [def_key]: this.sortedIndex.indexs[def_key]
        })
      }
    },
    set_observer(){
      const observer = new IntersectionObserver(
        entries => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              const isbn = entry.target.dataset.isbn;
              this.loadBook(isbn);
              observer.unobserve(entry.target);
            }
          }
        },
        {
          root: null,
          rootMargin: '300px', // ←「もうすぐ描画されそう」
          threshold: 0,
        }
      );
      
      // console.log(this.$refs)
      this.$refs.bookEls.forEach(el => {
        observer.observe(el);
      });
    },
    async loadSorts(){
      // console.log("call loadSorts")
      this.sortOrders = {
        "key": this.sortedIndex.default_key,
        "order": this.sortedIndex.default_order,
        "key_select": Object
          .entries(this.sortedIndex.indexs)
          .map(itm => ({"val" : itm[1].sort_key, "label": itm[1].sort_label})),
        "order_select": [{"label": "昇順", "val": "asc"}, {"label": "降順", "val": "desc"}],
        "indexs": await this.loadAllPagesParallel(this.sortedIndex.indexs)
      }
    },
    async loadTokens(){
      // console.log("call loadTokens")
      
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
    },
    async loadTags(){
      // console.log("call loadTags")
      
      const tagsIndex = await fetch(this.index.tags_index).then(r => r.json());
      this.tagsOrders = {
        "selected": [],
        // "selected": ["100"],
        "indexs": await this.loadAllPagesParallel(tagsIndex.indexs)
      }
    },
    loadAnarizer() {
      
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
    query_pane_open(){
      // console.log("call query_pane_open")
      this.query_panel.is_loading = false;
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
    show_reset(){
      this.show_isbn = null;
      this.detail_panel_layer_class.open = false;
      
    },
    show_detail(isbn){
      this.show_isbn = isbn
      this.detail_panel_layer_class.open = true;
      
      // console.log(this.show_isbn, this.detail_panel_layer_class)
    },
    open_notion(page_id){
      window.open("https://www.notion.so/"+page_id.replace(/\_/g, "").replace(/-/g, ""), '_blank')
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
    }
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