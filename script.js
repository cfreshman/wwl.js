// wwl.js (web-watch-library)  
// Some might consider this a framework, but WWF is taken  
// v0.0.7  

// Interactive builder: https://wwl-builder.tu.fo  
// Gallery: https://raw.tu.fo/wwl/app/gallery  
/* Example: (view at https://raw.tu.fo/wwl/app/example)

<head>
  <title>toggle</title>
  <meta name="description" content="wwl.js example" />
  <meta name="author" content="cyrus@freshman.dev">
  <link rel="icon" href="../icon-js.png">
</head>
<body>
  <script src="../wwl.js"></script>
  <script>
    wwl.attach({
      state: 0,
      states: [
        '<button id=1>off</button>',
        {
          html: '<button id=0>on</button>',
          style: 'filter: invert(1)',
        },
      ],
    })
  </script>
</body>

*/

/* Non-commerical license

Modified MIT license which disallows commercial purposes.
Please contact me if you decide to sell or use copies for commercial purposes.

Copyright (c) 2023 Cyrus Freshman

Permission is hereby granted, free of charge, to any person obtaining a copy of 
this software and associated documentation files (the "Software"), to use, 
copy, modify, merge, publish, distribute, and/or sublicense copies of the  
Software for non-commercial purposes, and to permit persons to whom the 
Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all 
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR 
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, 
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE 
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER 
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, 
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE 
SOFTWARE.

*/

// WARNING // I still need to clean this up.

// dependencies
;[
  '/lib/2/common.js',
].map(src=>document.head.append((x=>Object.assign(x,{innerHTML:(src=>(x=>{x.withCredentials=false;x.open('GET',src,false);x.send();return x.responseText})(new XMLHttpRequest()))(new URL(src,location.port?location.origin:'https://freshman.dev').toString())}))(document.createElement('script'))))

;(_=>{
  const log = named_log('wwl.js')

  // mini state utilities
  // used to maintain session (since Apple Watch doesn't store cookies right now)
  // DO NOT USE FOR PRODUCTION USECASES
  const api = window['api'] = (() => {
    const endpoint = [
      location.port && location,
      parent?.location.port && parent?.location,
      {
        origin: 'https://freshman.dev',
      }
    ].map(x=>x?.origin).find(x=>x).replace(/:\d+/, ':5050') + '/api'
    const api = {
      endpoint,
    }
    const _request = (url, req) => 
      fetch(url, req)
      .then(async res => ({
        'application/json': () => res.json().then(result => {
          if (res.ok) return result
          else {
            result.error = result.error || `failed ${service} ${path}: ${result.message}`
            throw result
          }
        }),
      }[(res.headers.get('Content-Type') || 'application/json').split(';')[0]] || (()=>res))())
      .catch(e => { throw { error: e.error ?? e.message ?? e } })
    Object.entries({
      get:    {},
      post:   { body: true },
      put:    { body: true },
      delete: {},
    }).map(([service, { method=service.toUpperCase(), body:has_body=false }]) => api[service] = (url, body={}, options={}) => {
      if (!has_body) options = body
      const controller = new AbortController()
      options.ms && setTimeout(() => controller.abort(), options.ms || 61_000)
      return _request(api.endpoint + url.replace(/^\/*/, '/'), {
        method,
        headers: {
          'Content-Type': has_body ? 'application/json' : undefined,
        },
        signal: controller.signal,
        body: has_body ? JSON.stringify(body) : undefined,
      })
    })
    return api
  })()
  log(api.endpoint, location.href)
  /*

  [== SESSIONS ==]
  GET /id  unique identifier for client (IPv6)
  POST /common-state: store mutable JSON object
    id: unique identifier e.g. session-1234
    update?: mutation (this implementation uses MongoDB syntax) e.g. { $set: { abc: 123 } }
    poll?: wait for next update
  
  */

  const sync = {
    instances:{},
    get values() { return Object.fromEntries(Object.entries(sync.instances).map(([k,v]) => [k, v.value])) },
    
    new: (id, on=undefined) => {
      const instance = {
        id, _loading:undefined, _cached:undefined, _open:undefined, _ons: new Set(on ? [on] : []),
        get value() { return instance.get() },
        set value(state) { return instance.set(state) },

        get: () => instance._cached,
        set: (state) => instance._open = instance._request({ state }),
        default: (state) => instance.set({ ...state, ...instance.get() }),
        update: (update={}) => instance._open = instance._request({ update }),

        sync: () => new Promise(resolve => {
          const existing = instance._cached || instance._loading
          if (existing) return resolve(existing)
          
          instance._loading = new ActionablePromise()
          defer(async _=> {
            instance.id = await instance.id
            instance._cached = false
            sync.instances[instance.id] = instance
            while (1) {
              const loading = instance._request({ poll: instance._loading?0:true })
              instance._loading?.resolve(loading)
              const state = await loading
              delete instance._loading
              if (state) { // only falsy after poll without update
                defer(() => [...instance._ons].map(on => on(state)))
              }
              if (instance._cached === undefined) return resolve(state)
              resolve(instance._cached = state)

              // FOR NOW forget about polling, something's wrong
              return
            }
          })
        }),
        settle: () => instance.sync().then(_=> instance).with(({ value }) => log('settled', instance.id, {...value})),
        unsync: () => delete instance._cached,
        
        on: (f) => instance._ons.add(f),
        un: (f) => instance._ons.delete(f),
        once: (f) => {
          const _f = x => {
            instance.un(_f)
            f(x)
          }
          instance.on(_f)
        },

        _request: (query) => {
          if (instance._cached) instance._cached = merge(query.state || instance._cached, query.update || {})
          if (query.update) query.delete = deletion(query.update)
          log('sync request', instance.id, query)
          return Promise
          .resolve(instance._open)
          .then(() => api.post('/state', { id:instance.id, ...query }))
          .then(value => instance._cached = value)
        },
      }
      instance.sync()
      return instance
    },

  }

  const session = sync.new(Promise.resolve(
    location.port 
    ? (() => {
      // mock IP for development using browser storage
      const id = localStorage.getItem('wwl-test-id') || Date.now()
      localStorage.setItem('wwl-test-id', id)
      return id
    })()
    : fetch(api.endpoint + '/id',{mode:'no-cors'}).then(x=>x.text())).then(raw_id => 'session-' + raw_id))
  
  // wwl object
  const wwl = window.wwl = {
    sync, session, attached: [],
    smartwatch: () => {
      // true if physical screen is small and square-ish
      const physical = {
        width: screen.width / devicePixelRatio,
        height: screen.height / devicePixelRatio,
      }
      // TODO don't use this for detection
      // if (parent) return false
      return top === window && physical.width < 400 && Math.abs(1 - (innerWidth / innerHeight)) < .25
    },
    dependencies: (list) => list.map(src => (xhr => {
      xhr.open('GET', src, false)
      xhr.send()
      document.head.append((x => Object.assign(x, { innerHTML:xhr.responseText }))(document.createElement('script')))
    })(new XMLHttpRequest())),
    attach: (definition) => {
      let {
        dependencies=[],
        at='html', hash=true, to=document.querySelector(at),
        postrender=()=>{}, 
        state=undefined, states=undefined, handle={}, prefix=undefined, init=undefined,
        title=document.title, subtitle=document.querySelector('[name=description]')?.content, footer=undefined,
        name=title||document.title, author=document.querySelector('[name=author]')?.content, icon=document.querySelector('[rel=icon]')?.href, theme='#e6dfdc',
        data,
        ...rest
      } = definition
      const defaults = { postrender, handle, prefix, title, subtitle, footer, ...rest }
      /**
       * attach: initialize a smartwatch web app. returns the app object
       * (optionally within an element - otherwise, this replaces the HTML root)
      */

      wwl.dependencies(dependencies)

      const is_mock = window === top && !wwl.smartwatch()
      const is_base = to === document.documentElement
      const full_mock = is_mock && is_base
      if (full_mock) {
        to = node(`<div style="
        position: absolute; top: 0; left: 0; height: 100%; width: 100%;
        "></div>`)
        document.body.append(to)
      }
      const app_session = wwl.attached.length && is_mock ? sync.new('session-mock-'+rand.alphanum(8)) : session

      // replace attach point HTML with wwl skeleton
      const at_L = to || document.querySelector(at)
      if (!at_L) return log('attach error', at, to)
      log('attach', at, at_L)
      at_L.classList.add('wwl-attach')
      const app_install = {
        "fishbowl": "https://freshman.dev/watchOS-fishbowl-install",
      }[name] || "https://freshman.dev/watchOS-wwl-install"
      const body_tag = at_L === document.documentElement ? 'body' : 'div'
      at_L.innerHTML = `
<head>
  <meta charset=utf-8>
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
  <meta name="HandheldFriendly" content="true" />
  <title>${name || document.title}</title>
  <link rel="manifest" id=wwl_manifest>
  <style>

  ${is_base ? `
  html, body, .wwl-attach {
    overflow: hidden;
  }
  ` : ''}
  
  .wwl-attach * {
    font-family: SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace;
    box-sizing: border-box;
    gap: .25em;
  }

  .wwl-attach {
    height: 100%; width: 100%;
    font-size: 14px;
    visibility: hidden;

    border-radius: var(--corner);
    overflow: hidden;
    background: #000 !important;
    touch-action: manipulation;
  }
  @media (max-aspect-ratio: 1/1) {
    .wwl-attach {
      user-select: none;
    }
  }
  
  .wwl-attach a {
    color: inherit;
    text-decoration: underline;
  }
  .wwl-attach :is(button, .button, [data-button], [onclick], a, input, textarea) {
    cursor: pointer;
    font-size: 1.25em;
    touch-action: manipulation;
    color: #000;
    display: inline-flex; flex-direction: column; align-items: stretch; justify-content: center; text-align: center;
  }
  .wwl-attach .toggled:is(button, .button, [data-button], a, input, textarea) {
    // filter: invert(1);
    color: #fff; background: #000;
  }
  .wwl-attach :is(button, .button, input:is(:not([type]), [type=text], [type=number]), textarea) {
    border: 1px solid #000;
    border-radius: 1rem;
    padding: .1667em .67em !important;
    resize: none;
  }
  .wwl-attach :is(button, .button) {
    background: #4002;
    user-select: none;
    text-transform: uppercase;
  }
  .wwl-attach :is(input:is(:not([type]), [type=text], [type=number]), textarea) {
    background: #fcc2;
  }
  .wwl-attach :is(input[type=number]) {
    text-align: right;
  }
  .wwl-attach :is(input[type=number])::-webkit-outer-spin-button,
  .wwl-attach :is(input[type=number])::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  .wwl-attach :is(input:is(:not([type]), [type=text], [type=number]), textarea)::placeholder {
    opacity: .25;
    color: #000;
    font-size: inherit;
  }
  .wwl-attach :is(input:is(:not([type]), [type=text], [type=number]), textarea):focus::placeholder {
    opacity: calc(.25 * .5);
  }
  .wwl-attach .title {
    font-weight: bold;
  }
  .wwl-attach .subtitle {
    font-style: italic;
    opacity: .5;
    font-size: .825em;
  }
  .wwl-attach .center {
    display: inline-flex; flex-direction: column; align-items: stretch; justify-content: center; text-align: center;
  }

  .wwl-attach {
    --corner-ratio: .25;
    --raw-height: 330;
    --raw-width: 320;
    --raw-safe: calc(var(--raw-height) - 2 * var(--raw-width) * var(--corner-ratio));

    --height: calc(var(--raw-height) * 1px);
    --width: calc(var(--raw-width) * 1px);
    --aspect: calc(--raw-width / --raw-height);
    --corner: calc(var(--width) * var(--corner-ratio));
    --safe: calc(var(--raw-safe) * 1px);
    --safe-aspect: calc(--raw-width / --raw-safe);
    
    --title: "";
    --subtitle: "";

    --button-background: background: #4002;
    --input-background: background: #fcc2;
    background: #000;
    display: flex; align-items: center; justify-content: center;
    white-space: pre-line;
  }

  .wwl-attach .wwl-body {
    margin: 0; padding: 0; flex-grow: 0;
    height: var(--height); min-height: var(--height);
    width: var(--width); min-width: var(--width);
    display: flex; flex-direction: column; justify-content: flex-end;
    border-radius: var(--corner);
    overflow: hidden;
  }
  .wwl-attach .wwl-app-root {
    z-index: 1;
    background: #fff;
    height: 100%; width: 100%;
    padding: var(--corner) .5em;
    display: flex; flex-direction: column;
    overflow: auto;
    border-radius: var(--corner);
    position: relative;

    /* display: flex; place-content: center;
    padding: .5em; */
  }
  .wwl-attach .wwl-app-root::before, .wwl-attach .wwl-app-root::after {
    z-index: 100;
    position: absolute;
    /* top: calc(100% - var(--height) + .5em);  */
    top: 0;
    left: 0;
    /* height: var(--corner); */
    width: 100%;
    display: flex; align-items: center; justify-content: center;
    white-space: pre;
    pointer-events: none;
  }
  .wwl-attach .wwl-app-root::before {
    height: calc(var(--width) * var(--corner-ratio) / 2);
    content: var(--title);
    font-weight: bold;
    /* height: fit-content;
    margin-top: 1em; */
    font-size: calc(1em / .825);
    text-transform: uppercase;
  }
  .wwl-attach .wwl-app-root::after {
    height: var(--corner);
    content: var(--subtitle);
    font-style: italic;
    opacity: .5;
    /* font-size: .825em; */
    text-transform: lowercase;
  }

  .wwl-mock {
    background: #e6dfdc !important;
    border-radius: 0;
    overflow: visible;
  }
  .wwl-mock .wwl-body {
    font-size: 12px;
    background: #222;
    box-shadow: 0 0 0 1em #000;
    /* height: 568px; */
    height: calc(var(--height) * 1.15);
    width: var(--width);
    /* height: var(--height); */
    aspect-ratio: var(--aspect);
    // border-radius: 20%;
    border-radius: var(--corner);
    position: relative;
    pointer-events: none;
    overflow: hidden;
  }
  .wwl-mock .wwl-body .wwl-close {
    color: #444;
    font-family: system-ui;
    box-sizing: border-box;
    height: calc(var(--height) * .15);
    flex-shrink: 0;
    display: flex;
    align-items: center;
    line-height: 1;
    padding-top: .575em;
    padding-left: 1em;
    font-size: 30px;
    
    pointer-events: all;
    cursor: pointer;
    width: fit-content;
    user-select: none;
  }
  /* .wwl-mock .wwl-body:hover:not(:has(:hover))::before,  */
  .wwl-mock .wwl-body.about .wwl-close {
    color: #fff;
  }
  .wwl-mock .wwl-app-root {
    background: #fff;
    height: var(--height);
    pointer-events: all;
    z-index: 1;

    // background: inherit;
    // overflow: hidden;
    overflow: auto;
    // border-radius: inherit;
  }
  .wwl-mock .wwl-app-root::-webkit-scrollbar {
    display: none;
  }
  .wwl-mock .wwl-about {
    font-size: 12px;
    position: absolute; bottom: 0; left: 0; height: 100%; width: 100%;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center; text-align: center;
    padding: calc(var(--height) - var(--safe) - var(--corner) * 2);
    padding: .5em;
  }
  .wwl-mock .wwl-about * {
    color: #fff;
    white-space: pre;
    font-size: 1em;
    pointer-events: all;
  }
  .wwl-mock .wwl-about .wwl-app-icon {
    height: 0;
    flex-grow: 1e6;
    cursor: pointer;
    pointer-events: none;
  }

  .wwl-mock .wwl-body {
    z-index: 2;
    overflow: visible;
    pointer-events: none;
  }
  .wwl-mock .wwl-body::after {
    content: "";
    position: absolute;
    height: 100%; width: 100%;
    margin: calc(var(--width) * -.05); border: calc(var(--width) * .05) solid transparent;
    border-radius: calc(var(--corner) / .8);
    pointer-events: all;
    z-index: -1;
    cursor: pointer;
  }
  .wwl-mock .wwl-body.wish .wwl-close {
    display: none !important;
  }
  .wwl-mock .wwl-body.wish .wwl-app-root {
    flex-grow: 1;
    opacity: 1;
    z-index: 1;
  }
  .wwl-mock #mock-controls {
    position: absolute;
    bottom: 0; left: 0; margin: .5em .25em;
  }

  html:not(:has(.wwl-mock)) {
    background: #000;
  }


  .wwl-attach .row :is(input, textarea) {
    font-size: 16px;
  }
  .wwl-attach .row, .wwl-attach .full {
    display: flex; align-items: center; gap: .25em; white-space: pre-line;
  }
  .wwl-attach .full {
    flex-grow: 1; flex-direction: column;
  }
  .wwl-attach br.full {
    height: 0;
    content: "";
  }
  .wwl-attach .row {
    flex-direction: row;
  }
  .wwl-attach .row > :is(input, textarea, button, .button) {
    width: 0; flex: 1; display: flex; flex-direction: row;
    align-items: center;
  }
  .wwl-attach .full, .wwl-attach .row:has(.full) {
    flex-grow: 1;
    white-space: pre-wrap;
    align-items: stretch;
  }
  .wwl-attach .large {
    font-size: 1.5em;
    font-weight: bold;
  }
  .wwl-attach [disabled]:is(input, textarea, button, .button) {
    opacity: .5;
    cursor: unset;
    pointer-events: none;
  }
  .wwl-attach .code {
    padding: .5em;
    background: #000; color: #fff;
    font-family: monospace;
    white-space: pre;
    overflow-x: auto;
  }
  .wwl-attach .wwl-footer .row {
    width: calc(100% - .5 * var(--corner));
  }
  </style>
</head>
<${body_tag} class="wwl-body ${JSON.parse(localStorage.getItem('wwl-wish-mode')||0) ? 'wish' : ''}">${wwl.smartwatch() ? '' : `
<div class=wwl-close>Oooo</div>
<div class=wwl-about>
  <br/><br/><br/><br/>
  <span style="flex-grow: 1"></span>
  ${icon ? `<img src="${icon}" class=wwl-app-icon />` : ''}
  ${name && !icon ? `<span style="font-size:2em;line-height:1.5">${name.toUpperCase()}</span>` : ''}
  ${author ? `<span>by ${author.replace(/([^@]+@)([^@]+)/, `<a href="mailto:${author}">$1</a>(<a href="http://$2">$2</a>)`)}</span>` : ''}
  ${icon || name || author ? '<br/>' : ''}
  <span style="flex-grow: 1"></span>
  <span><a href="sms:?&body=https://basin.fish">text</a> or <a href="${app_install}">install</a> to view on watch</span>
  <span>built with <a href='/lib/2/wwl.js'>wwl.js</a> - <a href='https://freshman.dev/raw/wwl/app'>gallery</span>
</div>`}<div class=wwl-app-root style="${defaults.style||''};"></div></${body_tag}>
`

      at_L.dataset['wwl_app_id'] = rand.alphanum(4)
      document.title = name || document.title
      if (icon) (document.querySelector('[rel=icon]') || (x => {
        document.head.append(x)
        return x
      })(node(`<link rel="icon"">`))).href = icon
      if (theme) {
        document.documentElement.style.background = theme
      }
      if (wwl_manifest) {
        wwl_manifest.href = URL.createObjectURL(new Blob([JSON.stringify({
          name: document.title,
          display: `standalone`,
          start_url: location.href,
          theme_color: theme,
          icons: icon ? [{
            src: icon,
            sizes: `512x512`,
          }] : undefined,
        })], { type: 'application/json' }))
        console.debug({wwl_manifest})
        document.head.append(node(wwl_manifest.outerHTML))
      }

      // additional styling based on initial render
      const { documentElement:html, body } = document
      const smartwatch = wwl.smartwatch()
      if (!smartwatch) at_L.classList.add('wwl-mock')
      ;(x => {
        x.innerHTML = `
        [data-wwl_app_id=${at_L.dataset['wwl_app_id']}] .wwl-attach {
          ${Object.entries({
            ...(smartwatch ? {
              'raw-height': innerHeight,
              'raw-width': innerWidth,
            } : {})
          }).map(([k, v]) => `--${k}: ${v};`).join('\n')}
        }`
        at_L.append(x)
      })(document.createElement('style'))

      // app instance contains wwl.app, but with this app passed as first parameter
      const root = at_L.querySelector('.wwl-app-root')
      const app = {
        wwl, sync, session: app_session,
        // generate random 8-character hex string as app ID
        L: at_L, root, hash,
        id: Math.floor(Math.random() * Math.pow(16, 8)).toString(16),
        name, handle,
        renders: {}, cleanup: [], postrender,
        meta: {
          get title() { return app._.title.value },
          set title(value) {
            app._.title.value = value
            if (app._.title.L) app._.title.L.textContent = value
            app.L.style.setProperty('--title', value ? `"(${value})"` : value)
          },
          get subtitle() { return app._.subtitle.L.content },
          set subtitle(value) {
            app._.subtitle.L.content = value
            app.L.style.setProperty('--subtitle', `"${value}"`)
          },
          get footer() { return app._.footer.L.innerHTML },
          set footer(html) {
            if (app.meta.footer !== html) app._.footer.L.innerHTML = html
            app.root.prepend(app._.footer.L)
          },
        },
        _: {
          state: undefined,
          title: {
            L: title ? at_L.querySelector('title') || node(`<title>${title}</title>`) : undefined,
          },
          subtitle: {
            L: at_L.querySelector('meta[name=description]') || node(`<meta name="description" content="" />`),
          },
          footer: {
            L: node(`<div class="wwl-footer" style="
            position: absolute;
            width: calc(100% - 1em - 2px); height: var(--corner);
            display: flex; align-items: center; justify-content: center;
            top: calc(100% - var(--corner));

            z-index: -1;
            "></div>`),
          },
          default: {
            ...defaults,
            class: root.className,
            cssText: root.style.cssText,
          },
        },
        data,
      }
      Object.keys(wwl.app).map(k => app[k] = (...x) => wwl.app[k](app, ...x))

      // assign title/subtitle and assign default
      app._.default.title = app.meta.title = title ?? app.meta.title
      app._.default.subtitle = app.meta.subtitle = subtitle ?? app.meta.subtitle
      app._.default.footer = app.meta.footer = footer ?? app.meta.footer

      // require session before evaluating states
      app.session.settle().then(_=> {
        if (init) init(app)
        if (states) app.states(states)
        if (hash) app.state(location.hash.slice(1) || (state ?? ''))
        else if (state !== undefined) app.state(state)
      })

      // setTimeout(() => app._.default.cssText = app._.default.cssText ?? app.root.style.cssText)

      // mock display
      // 1) 'Close' button
      // 2) re-attach, allow movement & allow more watches
      setTimeout(() => {
        if (app.L.classList.contains('wwl-mock')) {
          const wwl_body = app.L.querySelector('.wwl-body')
          const wwl_siblings = [...app.L.parentNode.querySelectorAll('.wwl-body')].filter(x => x !== wwl_body)
          const is_first = !wwl_siblings.length

          if (is_first) wwl_body.dataset['wwl_mock_original'] = true
          const wwl_original = app.L.parentNode.querySelector('[data-wwl_mock_original]')
          const window_handle_id = `wwl-handle-`+wwl_original.dataset['wwl_app_id']
          window[window_handle_id] = window[window_handle_id] || {}

          let down, moved

          if (is_first) {
            window[window_handle_id]['wwl-app-about'] = (show=undefined) => {
              if (!moved) {
                wwl_body.classList.toggle('about')
                if (app.root.style.transition) {
                  // app.root.style.top = '0'
                  // app.root.style.height = ''
  
                  // TODO mock actual transition
                  app.root.style.zIndex = 1
                  app.root.style.opacity = 1
                  setTimeout(() => app.root.style.transition = '', 250)
                } else {
                  // app.root.style.position = 'relative'
                  // app.root.style.top = '0'
                  // app.root.style.height = '50%'
                  app.root.style.opacity = 0
                  app.root.style.transition = '250ms'
                  setTimeout(() => {
                    // app.root.style.top = '100%'
                    app.root.style.zIndex = -1
                  })
                }

                // TODO
                if (show !== undefined && wwl_body.classList.contains('about') !== show) {
                  window[window_handle_id]['wwl-app-about']()
                }
              }
            }
          }

          if (full_mock || (is_mock && !is_first)) {
            if (is_first) {
              let wish = false
              window[window_handle_id]['wish-mode'] = (toggle=true) => {
                if (toggle) wish = !wish
                localStorage.setItem('wwl-wish-mode', wish)
                console.debug({ wish }, [...app.L.parentNode.querySelectorAll('.wwl-body')])
                ;[...app.L.parentNode.querySelectorAll('.wwl-body')].map(x => {
                  wish ? x.classList.add('wish') : x.classList.remove('wish')
                  if (x.classList.contains('about')) x.querySelector('.wwl-close').click()
                })
                // window[window_handle_id]['wwl-app-about'](false)
              }
              window[window_handle_id]['wish-mode'](false)
              window[window_handle_id]['new-watch'] = () => app.L.parentNode.append(
                wwl.attach({ 
                  ...definition,
                  to:node(`<div style="
                  position: absolute; top: 0; left: 0; height: 100%; width: 100%;
                  "></div>`)
                })
                .L)
            }
            app.L.append(node(`
            <div id=mock-controls style="
            display: flex; flex-direction: row;
            ">
              <button style="
              opacity:.5;
              display:none; /* maybe re-enable later */
              " onclick="
              window['${window_handle_id}']['wish-mode']()
              event.target.style.opacity = event.target.style.opacity == 1 ? .5 : 1
              ">wish mode</button>
            </div>`))
            app.L.append(node(`
            <div id=mock-center-controls style="
            position: absolute; top: 0; left: 0; height: 100%; width: 100%;
            display: flex; flex-direction: column; align-items: center; justify-content: center;
            pointer-events: none;
            ">
              <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; pointer-events: all">
                <button style="display:unset" onclick="
                window['${window_handle_id}']['new-watch']()
                ">new</button>
                <button onclick="
                window['${window_handle_id}']['wish-mode']()
                event.target.textContent = (event.target.textContent[0] === 'w' ? 'disable ' : '') + 'wish mode'
                ">wish mode</button>
              </div>
            </div>`))
            app.L.append(node(`<style>
            .wwl-body::after {
              cursor: move !important;
            }
            </style>`))
            
            const rect = wwl_body.getBoundingClientRect()
            wwl_body.style.cssText += `
            position: fixed; top: ${rect.y}; left: ${rect.x};
            `
            wwl_body.onpointerdown = e => {
              if (e.target.querySelector('.wwl-app-root')) {
                moved = false
                down = [e.clientX, e.clientY]
                e.preventDefault()
              }
            }
            window.addEventListener('pointermove', e => {
              if (down) {
                e.preventDefault()
                e.stopImmediatePropagation()
                const new_down = [e.clientX, e.clientY]
                wwl_body.style.top = (rect.y += new_down[1] - down[1]) + 'px'
                wwl_body.style.left = (rect.x += new_down[0] - down[0]) + 'px'
                down = new_down
                moved = true
              }
            })
            window.addEventListener('pointerup', e => down = moved = undefined)
          } else {
            defer(_=> window['wish-mode'](false))
          }

          const isOutside = (e, L=wwl_body) => {
            const rect = L.getBoundingClientRect()
            return e.clientX < rect.x || rect.x + rect.width < e.clientX || e.clientY < rect.y || rect.y + rect.height < e.clientY
          }
          ;[wwl_body.querySelector('.wwl-close'), wwl_body.querySelector('.wwl-app-icon')].map(mock_L => mock_L?.addEventListener('click', e => {
            if (e.target === mock_L && !moved) {
              if (isOutside(e, mock_L)) {
                // return // TODO figure out combined UI for new + wishmode toggle
                window[window_handle_id]['wwl-app-wish']()
              } else {
                if (is_first) {
                  window[window_handle_id]['wwl-app-about']()
                } else {
                  app.detach()
                }
              }
            }
          }))
        }
      })

      // return wwl app instance
      wwl.attached.push(app)
      return app
    },
    app: {
      defaults: (app, defaults={}) => Object.assign(app._.default, defaults),

      /**
       * render content for state
       * @param {*} app 
       * @param {*} id 
       */
      _renders: Promise.resolve(),
      render: async (app, id, parameters=[]) => {
        window['app'] = app // provide access to most recently rendered app from console
        await app.session.settle()

        app.root.style.visibility = 'visible'

        const _resolve = async value_or_function => {
          try {
            return value_or_function?.apply ? value_or_function(app, parameters) : value_or_function
          } catch (e) {
            log('render error', e)
            return undefined
          }
        }

        if (!app.renders[id]) return (app._.default.handle[id]) ? await _resolve(app._.default.handle)[id](app) : undefined

        let resolve, promise = new Promise(x => resolve = x)
        const prev_render = wwl.app._renders
        wwl.app._renders = wwl.app._renders.then(() => promise)
        await prev_render

        const from_state = app.state()
        const to_state = id
        app._.state = to_state
        app._.parameters = parameters
        log('render', to_state, app.renders[id], parameters)

        let {
          text=undefined, html=undefined, state=undefined, buttons=undefined,
          handle=undefined, prefix=app._.default.prefix, suffix=app._.default.prefix, postrender=app._.default.postrender,
          align='stretch', /* top top-right ... left top-left center stretch */
          title=undefined, subtitle=undefined, footer=undefined,
          class:_class=undefined, style=undefined,
          data=undefined,
        } = Object.assign({}, app._.default, app.renders[id] || {})

        if ((text ?? html ?? state ?? buttons) === undefined) {
          log('app render undefined', id, app, app.renders[id])
          return
        }
        while (app.cleanup.length) app.cleanup.shift()()
        app.root.className = app._.default.class
        app.root.style.cssText = app._.default.cssText

        // resolve content first (which may have side effects), then other meta values
        console.debug('app data', app.data, data)
        app.data = data = (await _resolve(data || app.data)) || app.data
        console.debug('app data resolved', app.data)
        prefix = await _resolve(prefix)
        {
          text = await _resolve(text)
          html = await _resolve(html)
          if (state !== undefined) promise.then(async () => wwl.app.state(app, state)) // change state before side effect's setTimeouts
          state = await _resolve(state)
          buttons = await _resolve(buttons)
        }
        suffix = await _resolve(suffix) || ''
        if ((text ?? html ?? state ?? buttons) === undefined) {
          log('app render undefined', id, app)
          return
        } else {
          log('app render', { text, html, state, buttons, prefix, suffix })
        }

        handle = await _resolve(handle) || {}
        align = await _resolve(align)
        title = await _resolve(title)
        subtitle = await _resolve(subtitle)
        footer = await _resolve(footer)
        _class = await _resolve(_class)
        const _style = (await Promise.all([app._.default.style, style].map(x => _resolve(x)))).filter(x => x)
        // console.debug(style, _style)
        style = _style.join(';')
        // prefix = `<style>${(_style.join('\n'))}</style>` + (prefix || '')
        prefix = _style.map(x => `<style>
        [data-wwl_app_id=${app.L.dataset['wwl_app_id']}] .wwl-app-root {
          ${x}
        }
        
        ${x}
        </style>`).join('') + (prefix || '')

        // console.debug('render', { text, html, state, buttons})

        // render new content
        // app.root.style.visibility = 'hidden'
        app.root.style.visibility = 'visible'
        promise.then(() => {
          log('wwl state transition', from_state, '=>', to_state, app.data, app)
          if (from_state !== to_state) app.root.scrollTop = 0
          postrender(app)
          // app.root.style.visibility = 'visible'
        })
        if (buttons !== undefined) {
          let { n, press=_=>_ } = buttons.n ? buttons : { n:buttons }
          // console.debug({buttons})
          n = Math.max(1, n)

          // generate button layout with svg
          // all layouts use the same exterior mask
          const style = `
          position: absolute; top: 0; left: 0; height: 100%; width: 100%;
          border-radius: inherit;
          `
          app.root.innerHTML = `<div style="${style}"></div>`
          const rect = app.root.children[0].getBoundingClientRect()
          const aspect = rect.width / rect.height
          const shapes = []

          // produce rectangles in [[-1, -1], [1, 1]]
          // find closest sqaure-ish number
          // (iterate though values up to sqrt(n) and keep last factor of n or n + 1)
          // (if for n + 1, place larger shapes in center)
          // TODO actually use this
          let split = 1
          for (let i = 1; i <= Math.sqrt(n + 1); i++) {
            if (n / i % 1 === 0 || (n + 1) % 1 === 0) split = i
          }
          // console.debug('button split', n, split, Math.ceil(n / split))

          const gap = 0 // .05
          let max_split = 1
          // odd - upper/lower, even - left/right
          if (n % 2 || 1) {
            const upper = Math.ceil(n / 2), lower = Math.floor(n / 2)
            max_split = Math.max(upper, lower, lower && upper ? 2 : 1)
            let y = -1
            ;[lower, upper].map((half, i) => {
              if (!half) return
              let x = -1;
              for (let j = 0; j < half; j++) {
                const s_i = i % 2 ? (half - 1 - j) + (shapes.length - j) : shapes.length
                const width = (2 / half) - gap/2
                const height = (lower ? 1 : 2) - gap/2
                shapes.push(`
<g fill="hsl(${s_i / (n + 1) * 360 - 15}deg 100% 50%)">
  <rect data-button=buttons x="${x}" y="${y/aspect}" height="${height/aspect}" width="${width}" />
  <text x="${x + width/2}" y="${y/aspect + height/aspect/2}" dominant-baseline="middle" text-anchor="middle">${s_i + 1}</text>
</g>`)
              x += 2 / half + gap
            }
            y += 1 + gap/2
          })
        }

        app.root.innerHTML = `
<style>
  .wwl-app-root.wwl-app-root {
    background: none;
    padding: 0 0 .5em 0;
    border-radius: 0;
  }
  .wwl-app-root::before,
  .wwl-app-root::after {
    display: none;
  }
</style>
<div class="center" style="
height: 100%; width: 100%;
border-radius: var(--corner);
position: relative;
">
<svg viewBox='-.98 -.98 1.96 1.96' style="${style}">
<filter id=shadow x="0" y="0" width="100%" height="100%">
  <feOffset result="off-up" in="SourceAlpha" dx="-${.025 / max_split}" dy="-${.025 / max_split}" />
  <feOffset result="off-down" in="SourceAlpha" dx="${.025 / max_split}" dy="${.025 / max_split}" />
  <feColorMatrix result="off-down-black" in="off-down" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 1 0" />
  <feBlend in="off-up" in2="off-down-black" mode="normal" />
</filter>
<g id=shapes>${shapes.join('')}</g>
<style>
  #shapes rect {
    stroke-width: .01;
    stroke: #000;
  }
  #shapes text {
    filter: url(#shadow);
    font-size: ${1 / max_split}px;
    font-family: system-ui;
    fill: #000;
    pointer-events: none;
    stroke: #000;
    stroke-width: ${.1 / max_split}px;
    stroke-linejoin: round;
    overflow: visible;
  }
</style>
</svg>
</div>
`
        }
        else if (text !== undefined) {
          app.root.textContent = text
          app.root.innerHTML = prefix + app.root.innerHTML + suffix
        }
        else if (html !== undefined) app.root.innerHTML = prefix + html + suffix

        // align 
        if (align !== undefined) {
          const place = CSS.supports('place-items', align) ? align : [
            align.includes('left') ? 'flex-start' : align.includes('right') ? 'flex-end' : 'center',
            align.includes('top') ? 'flex-start' : align.includes('bottom') ? 'flex-end' : 'center',
          ].join(' ')

          const horizontal = place.split(' ')[1] || place
          const text = CSS.supports('text-align', align) ? align : align.includes('left') ? 'left' : align.includes('right') ? 'right' : /*horizontal === 'stretch' ? 'center' :*/ horizontal || 'left'
          
          Object.assign(app.root.style, {
            display: 'flex', flexDirection: 'column',
            placeItems: place, placeContent: place,
            textAlign: text,
          })
        }

        // meta
        app.meta.title = title ?? app._.default.title
        app.meta.subtitle = subtitle ?? app._.default.subtitle
        app.meta.footer = footer ?? app._.default.footer

        // additional styles
        if (_class) {
          const class_list = _class.split(' ')
          app.cleanup.push(() => class_list.map(x => app.root.classList.remove(x)))
          class_list.map(x => app.root.classList.add(x))
        }
        if (style) app.root.style.cssText += ';\n' + style
        // console.debug(style, app.root.style.cssText)

        app.L.style.visibility = 'visible'

        handle = {
          ...app._.default.handle,
          ...handle,
        }
        // console.debug({handle})

        // id-based handlers
        Array
        .from(app.root.querySelectorAll(':is(button, .button, [data-button])'))
        .map(x => {
          const checkbox = x.querySelector('input[type=checkbox]')
          const query = () => x.dataset['button'] || x.id || x.textContent
          const _onclick = x.onclick
          x.onclick = e => {
            (_onclick || handle[query()] || (checkbox && (() => checkbox.click())) || (_ => app.state(query())))(app, e)
          }
        })

        // assigned handlers
        // handler is either { id: () => func } for onclick or { id: { event: e => func } }
        Object.entries(handle).map(([id, handler]) => {
          console.debug('handler', id, handler)
          const _handler = handler
          if (handler.apply) handler = { onclick: e => e.target.value !== undefined || _handler(e.target.value), onchange: e => e.target.value !== undefined && _handler(e.target.value) }
          app.L.querySelectorAll('#'+id).forEach(x => Object.entries(handler).map(([event, callback]) => {
            const _onevent = x[event]
            x[event] = e => (_onevent || callback)(e)
          }))
        })

        // for actual smartwatch: erase input[type=number] value on click
        app.root.querySelectorAll('input[type=number]').forEach(x => {
          x.addEventListener('click', e => {
            x.dataset['unset'] = x.value
            x.value = ''
          })
        })

        // text expand
        defer([...app.root.querySelectorAll('.text-fill')].map(async x => {
          x.style.height = x.style.width = '100%'
          const outer = x.getBoundingClientRect()
          x.style.height = x.style.width = 'fit-content'

          css(x, `
          word-break: keep-all;
          display: inline-flex; align-items: center; justify-content: center;
          flex-direction: row; flex-wrap: wrap;
          `)
          let fontSize = 12
          x.style.fontSize = fontSize + 'px'
          for (; x.clientHeight <= outer.height && x.clientWidth <= outer.width; fontSize++) {
            x.style.fontSize = fontSize + 'px'
          }
          x.style.fontSize = (fontSize - 1) + 'px'
          x.style.height = x.style.width = '100%'

          // fix off-center wrapping from spaces
          const _temp = node('<div></div>')
          document.body.append(_temp)
          _temp.style.cssText = x.style.cssText
          _temp.style.width = x.clientWidth + 'px'
          _temp.style.height = 'max-content'
          const text = x.textContent
          _temp.textContent = text[0]
          const characters = text.split('')
          for (let prev_height = _temp.clientHeight, i = 1; i < text.length; _temp.textContent += text[i], i++) {
            if (_temp.clientHeight > prev_height) {
              const space = _temp.textContent.slice(0, -1).lastIndexOf(' ')
              characters[space] = '\n'
              if (text[i] === ' ') characters[i] = ''
              prev_height = _temp.clientHeight
            }
            console.debug(_temp.clientHeight, _temp.textContent.lastIndexOf(' '), _temp.textContent, characters.join(''))
          }
          x.innerHTML = characters.join('').split(/[ \n]/).map(x => `<span style="font-family:inherit">${x}</span>`).join(' ')
          _temp.remove()
        }))

        app.L.dataset['state'] = id
        resolve(true)
        return true // the state transition was completed successfully
      },

      /**
       * define or assign state
       * @param {*} app app
       * @param {*} id unique user-defined value for state
       * @param {*} render if undefined, render & set state to id. if defined, call when state set to this id
       */
      state: (app, id_or_id_and_parameters=undefined, render=undefined) => {
        const [id, parameters] = 
          Array.isArray(id_or_id_and_parameters) 
          ? [id_or_id_and_parameters[0], id_or_id_and_parameters.slice(1)]
          : [id_or_id_and_parameters, [{}]]
        
        if (id === undefined) {
          return app._.state
        }
        else if (render) {
          // render may be single function to be interpreted as html, or options object like { html?, text?, align? }
          if (undefined === (render.html ?? render.text ?? render.state ?? render.buttons)) {
            render = { html: render }
          }
          app.renders[id] = render

          if (id === app._.state) wwl.app.render(app, id, parameters)
        } 
        else {
          wwl.app.render(app, id, parameters).then(success => {
            log('state', { id, success })
            if (!success) return

            // hash state
            if (app.hash && wwl.attached[0] === app) {
              location.href = location.href.replace(location.hash || /$/, '#'+id)
              location.hash = location.hash.replace(/^#+/, '')
            }
          })
        }
      },
      parameters: (app, parameters) => {
        if (parameters === undefined) return app._.parameters
        else wwl.app.state(app, [wwl.app.state(app), parameters])
      },
      states: (app, states) => Object.keys(states).map(id => wwl.app.state(app, states[id].id || id, states[id])),
      has: (app, state) => !!app.renders[state],

      rerender: _=> app.state(app.state()),
      reload: _=> {
        app.L.innerHTML = ''
        location.reload()
      },

      detach: (app) => {
        wwl.attached.splice(wwl.attached.indexOf(app), 1)
        console.debug(app, wwl.attached)
        if (wwl.attached.length) {
          app.L.remove()
        } else {
          app.L.innerHTML = ''
          app.L.classList.remove('wwl-attach')
          app.L.classList.remove('wwl-mock')
        }
      },
    },
  }
})()