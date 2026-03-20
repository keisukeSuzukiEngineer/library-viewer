const { createApp } = Vue;

Vue.createApp({
  data() {
    return {
      query_panel:{
        is_loading: true,
      },
      
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
      console.log("call sort_match_isbns")
      if(!this.sortOrders || !this.sortOrders.key)return []
      return this.sortOrders.indexs[this.sortOrders.key] || [];
    },
    token_match_isbns(){
      if(!this.kuromoji.tokenizer || !this.tokenOrders.searchText)return []
      const words = this.kuromoji.tokenizer
        .tokenize(this.tokenOrders.searchText)
        .filter(t =>
          ["名詞", "動詞", "形容詞"].includes(t.pos)
        )
        .map(t => t["basic_form"])
        
      if(!words || words.length <= 0)return []
      
      // //orバージョン
      // const isbns = new Set(
        // words
        // .flatMap(token => [...this.tokenOrders.indexs[token] || []])
      // );
      
      // andバージョン
      const [first_isbns, ...rest_isbns] = words
        .map(token => this.tokenOrders.indexs[token])
        .filter(Boolean)
        .sort((a, b) => a.size - b.size);

      const isbns = rest_isbns
        .reduce(
          (base_isbns, filter_isbns)=>new Set([...base_isbns].filter(isbn => filter_isbns.has(isbn))),
          new Set(first_isbns || [])
        )
        
      return isbns;
      
    },
    tag_match_isbns(){
      if (!this.tagsOrders.selected || this.tagsOrders.selected.length <= 0) return []
      
      const isbns = new Set(
        this.tagsOrders.selected
          .flatMap(token => [...this.tagsOrders.indexs[token]] || [])
      );
      console.log("token isbns:", isbns)
      return isbns;
      
    },
    visibleIsbns(){
      // 1. 並び順（ISBN配列）
      console.log("call visibleBooks")
      
      let isbns = this.sort_match_isbns
      console.log("sorted isbns.length: ", isbns.length)
      if(isbns.length == 0)return isbns
      
      if(this.token_match_isbns.size > 0){
        isbns = isbns.filter(isbn => this.token_match_isbns.has(isbn));
      }
      console.log("tokened isbns.length: ", isbns.length)
      if(isbns.length == 0)return isbns
      
      console.log(this.tag_match_isbns)
      if(this.tag_match_isbns.size > 0){
        isbns = isbns.filter(isbn => this.tag_match_isbns.has(isbn));
      }
      console.log("taged isbns.length: ", isbns.length)
      if(isbns.length == 0)return isbns
      
      return isbns;
    }
  },
  async mounted() {
    await this.loadIndex();
    await this.loadFirstSort();
    this.set_observer();
    await this.loadSorts();
    await this.loadTokens();
    await this.loadTags();
    await this.ensureKuromoji();
    this.query_pane_open();
  },

  methods: {
    async loadIndex(){
      console.log("call loadIndex")
      this.index = await fetch("json/index.json").then(r => r.json());
    },
    async loadFirstSort(){
      console.log("call loadFirstSort")
      this.sortedIndex = await fetch(this.index.sorted_inex).then(r => r.json());
      console.log(this.sortedIndex)
      
      const def_key = this.sortedIndex.default_key;
      console.log(def_key, this.sortedIndex.indexs[def_key])
      console.log({
            def_key: this.sortedIndex.indexs[def_key]
        })
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
      
      console.log(this.$refs)
      this.$refs.bookEls.forEach(el => {
        observer.observe(el);
      });
    },
    async loadSorts(){
      console.log("call loadSorts")
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
      console.log("call loadTokens")
      
      this.tokenIndex = await fetch(this.index.token_index).then(r => r.json());
      const indexScores = await this.loadAllPagesParallel(this.tokenIndex.indexs)

      this.tokenOrders = {
        "indexs": Object.fromEntries(
          Object.entries(indexScores.tokens).map(([key, valueDict]) => [
            valueDict.token,
            new Set(Object.entries(valueDict.isbns).map(itm => itm[0]))
          ])
        ),
        "indexScores": indexScores
      }
    },
    async loadTags(){
      console.log("call loadTags")
      
      const tagsIndex = await fetch(this.index.tags_index).then(r => r.json());
      this.tagsOrders = {
        "selected": [],
        // "selected": ["100"],
        "indexs": await this.loadAllPagesParallel(tagsIndex.indexs)
      }
    },
    ensureKuromoji() {
      if (this.kuromoji.stat != "wait") return;
      
      if (this.kuromoji.promise) {
        return this.kuromoji.promise;
      }
  
      this.kuromoji.stat = "loading";
      this.kuromoji.promise = (async () => {
        // ① script読み込み
        if (!window.kuromoji) {
          await new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = "https://unpkg.com/kuromoji/build/kuromoji.js";
            script.onload = resolve;
            script.onerror = reject;
            document.body.appendChild(script);
          });
        }

        // ② tokenizer生成
        return await new Promise(resolve => {
          kuromoji.builder({
            dicPath: "https://unpkg.com/kuromoji/dict/"
          }).build((err, tokenizer) => {
            this.kuromoji.tokenizer = tokenizer;
            this.kuromoji.stat = "standby";
            console.log("kuromoji standby")
            resolve(tokenizer);
          });
        });
      })();
      
      return this.kuromoji.promise;
    },
    query_pane_open(){
      console.log("call query_pane_open")
      this.query_panel.is_loading = false;
    },
    async loadAllPagesParallel(indexs, isbnIsSet = false) {
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
      
      console.log(this.show_isbn, this.detail_panel_layer_class)
    },
    open_notion(page_id){
      window.open("https://www.notion.so/"+page_id.replace(/\_/g, "").replace(/-/g, ""), '_blank')
    }
  },
  watch: {
    // visibleIsbns: {
      // immediate: true,
      // handler(newIsbns) {
        // newIsbns.forEach(isbn => {
          // this.loadBook(isbn);
        // });
      // }
    // }
  }
}).mount("#app");
