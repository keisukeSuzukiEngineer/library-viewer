const { createApp } = Vue;

Vue.createApp({
  data() {
    return {
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
    visibleIsbns(){
      // 1. 並び順（ISBN配列）
      console.log("call visibleBooks")
      if(!this.sortOrders.key)return []
      const sortKey = this.sortOrders.key;
      let items =
        this.sortOrders.indexs[sortKey];
      console.log("key: ", sortKey)
      console.log("Object.keys(this.sortOrders.indexs): ", Object.keys(this.sortOrders.indexs))
      console.log("items: ", items)
      
      const useFilters = []

      // 2. タグ絞り込み用 Set（AND 条件）
      if (this.tagsOrders.selected && this.tagsOrders.selected.length > 0) {
        this.tagsOrders.selected
          .map(tag => this.tagsOrders.indexs[tag])
          .forEach(s => useFilters.push(s))
      }

      // 3. トークン（検索）絞り込み用 Set
      if (this.tokenOrders.selected && this.tokenOrders.selected.length > 0) {
        this.tokenOrders.selected
          .map(token => this.tokenOrders.indexs[token])
          .forEach(s => useFilters.push(s))
      }
      
      
      console.log("useFilters: ", useFilters)
      if(useFilters.length > 0){
        const [first, ...rest] = useFilters;
        const mergedFilter = rest.reduce(
          (acc, s) => new Set([...acc].filter(x => s.has(x))),
          new Set(first)
        );
        console.log("mergedFilter:" ,mergedFilter)
        items = items.filter(isbn =>  mergedFilter.has(isbn))
      }

      // 4. フィルタ & book 解決
      console.log("items: ", items)
      
      return items
          // if (tagSet && !tagSet.has(isbn)) return false;
          // // if (tokenSet && !tokenSet.has(isbn)) return false;
          // return true;
        // })
        // .map(isbn => this.booksByIsbn[isbn])
        .filter(Boolean); // 未ロード除外
    }
  },

  async mounted() {
    await this.loadInitial();
    this.set_observer();
    
    
    // v-for + ref="bookEls" → 配列になる
    this.$refs.bookEls.forEach(el => {
      this.observer.observe(el);
    });
  },

  methods: {
    async loadInitial() {
      console.log("call loadInitial")
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
      console.log(this.sortOrders)
      
      const tagsIndex = await fetch(index.tags_index).then(r => r.json());
      console.log(tagsIndex)
      this.tagsOrders = {
        ...{
          // "selected": ["100"],
          "selected": [],
          "indexs": await loadAllPagesParallel(tagsIndex)
        }
      }
      console.log(this.tagsOrders)
      
      const tokenIndex = await fetch(index.token_index).then(r => r.json());
      console.log(tokenIndex)
      const indexScores = await loadAllPagesParallel(tokenIndex)
      console.log(indexScores)
      this.tokenOrders = {
        ...{
          // "selected": ["すすめ"],
          "selected": [],
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
      console.log(this.tokenOrders )

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