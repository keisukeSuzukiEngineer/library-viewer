const { createApp } = Vue;

let tokenizer;


Vue.createApp({
  data() {
    return {
      query_panel:{
        text_panel:{
          placeholder: "pending...",
          disabled: true
        }
      },
      
      // 書籍実体
      booksByIsbn: {},

      // 現在の表示順（ISBN配列）
      orderedIsbns: [],
      
      sortOrders: {},
      tagsOrders: {},
      tokenOrders: {},
      
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
    // visibleBooks() {
      // return ["a", "b"];
    // },
    sort_match_isbns(){
      // console.log("call sort_match_isbns key:", this.sortOrders.key)
      if(!this.sortOrders.key)return []
      
      return this.sortOrders.indexs[this.sortOrders.key];
    },
    token_match_isbns(){
      
      console.log(this.tokenOrders.searchText)
      if(!tokenizer || !this.tokenOrders.searchText)return []
      // console.log(tokenizer.tokenize(this.tokenOrders.searchText))
      const words = tokenizer
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

      // for (let i = 1; i < sets.length; i++) {
        // isbns = new Set([...result].filter(x => sets[i].has(x)));
      // }
      console.log("token isbns:", isbns)
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
    await this.loadInitial();
    this.set_observer();
    
    
    // v-for + ref="bookEls" → 配列になる
    this.$refs.bookEls.forEach(el => {
      this.observer.observe(el);
    });
    
    
    // 初期化（1回だけ）
    kuromoji.builder({
      dicPath: "https://unpkg.com/kuromoji/dict/"
    }).build((err, t) => {
      tokenizer = t;
      this.query_panel.text_panel.placeholder = "";
      this.query_panel.text_panel.disabled = false;
      console.log("kuromoji ready");
    });
  },

  methods: {
    async loadInitial() {
      // console.log("call loadInitial")
      // 1. index.json
      const index = await fetch("json/index.json").then(r => r.json());
      
      const sortedIndex = await fetch(index.sorted_inex).then(r => r.json());
      console.log(sortedIndex)
      this.sortOrders = {
        ...{
          "key": sortedIndex.default_key,
          "order": sortedIndex.default_order,
          "key_select": Object.entries(sortedIndex.indexs).map(itm => ({"val" : itm[1].sort_key, "label": itm[1].sort_label})),
          "order_select": [{"label": "昇順", "val": "asc"}, {"label": "降順", "val": "desc"}],
          "indexs": await loadAllPagesParallel(sortedIndex)
        }
      }
      // console.log(this.sortOrders)
      
      const tagsIndex = await fetch(index.tags_index).then(r => r.json());
      // console.log(tagsIndex)
      this.tagsOrders = {
        ...{
          "selected": [],
          // "selected": ["100"],
          "indexs": await loadAllPagesParallel(tagsIndex)
        }
      }
      // console.log(this.tagsOrders)
      
      const tokenIndex = await fetch(index.token_index).then(r => r.json());
      // console.log(tokenIndex)
      const indexScores = await loadAllPagesParallel(tokenIndex)
      // console.log(indexScores)
      this.tokenOrders = {
        ...{
          // "searchText": "test",
          "selected": [],
          // "selected": ["すすめ"],
          "indexs": Object.fromEntries(
            Object.entries(indexScores.tokens).map(([key, valueDict]) => [
              valueDict.token,
              new Set(Object.entries(valueDict.isbns).map(itm => itm[0]))
              // new Set(Object.entries(valueDict.isbns).map(itm => itm.isbn))
              // new Set(valueDict['isbns'])
            ])
          ),
          "indexScores": indexScores
        }
      }
      // console.log(this.tokenOrders )

      // 3. 最初のページだけ読む
      // await this.loadNextPage();
    },
    set_observer(){
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
    async loadNextPage() {
      if (this.loadedPages >= this.pagePaths.length) return;

      const pagePath = this.pagePaths[this.loadedPages];
      const page = await fetch(pagePath).then(r => r.json());

      this.loadedPages++;

      // ISBN を順序に追加
      for (const isbn of page.order) {
        this.orderedIsbns.push(isbn);
        this.loadBook(isbn); // 非同期で書籍ロード
      }
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


async function loadAllPagesParallel(indexObj, isbnIsSet = false) {
  const result = {};

  await Promise.all(
    Object.entries(indexObj.indexs).map(async ([key, info]) => {
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


console.log(document.getElementById("app"));