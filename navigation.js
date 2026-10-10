/* Enhance existing menu nodes without duplicating auth or Firestore listeners. */
(function(){
  'use strict';
  function init(){
    const menu=document.getElementById('dropdownMenu');
    if(!menu||menu.dataset.navigationReady==='true')return;
    menu.dataset.navigationReady='true';
    const app=document.getElementById('appContent');
    const host=app||document.body;
    const mobile=window.matchMedia('(max-width:900px)');
    const body=document.body;
    body.classList.add('nt-navigation');
    if(!app)body.classList.add('nt-profile');
    try{body.classList.toggle('nt-nav-collapsed',localStorage.getItem('lager-navigation-collapsed')==='true')}catch(_){}
    const bar=document.createElement('div');bar.className='nt-topbar';
    bar.innerHTML='<div class="nt-brand">Netzbau Tafers<small>Lagermanager</small></div><button type="button" class="nt-toggle" aria-controls="dropdownMenu" aria-label="Navigationsmenü öffnen oder schliessen"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg><span>Menü</span></button>';
    host.prepend(bar);
    const toggle=bar.querySelector('button');
    const backdrop=document.createElement('div');backdrop.className='nt-backdrop';backdrop.setAttribute('aria-hidden','true');host.append(backdrop);
    menu.classList.remove('open');menu.setAttribute('role','navigation');menu.setAttribute('aria-label','Hauptnavigation');host.append(menu);
    const iconPaths={uebersicht:'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',fahrzeuge:'M3 15V9l2-5h14l2 5v6M3 9h18M3 15h18M5 15v5M19 15v5M6 12h2M16 12h2',home:'M3 10 12 3 21 10v11h-6v-7H9v7H3z',index:'M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0M18 18l3 3',baustellen:'M4 17v-4a8 8 0 0 1 16 0v4M9 5v7M15 5v7M2 17h20v4H2z',archiv:'M3 7h18v14H3zM2 3h20v4H2zM9 11h6',logs:'M5 2h14v20H5zM8 7h8M8 12h8M8 17h5',kabelreport:'M3 21h18M6 17v-5M12 17V4M18 17V8',profil:'M16 6a4 4 0 1 1-8 0 4 4 0 0 1 8 0M4 22v-4c0-6 16-6 16 0v4z',benutzer:'M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6M2 21v-3c0-5 14-5 14 0v3M16 4a3 3 0 0 1 0 6M19 14c2 1 3 2 3 4v3',backup:'M4 4h16v16H4zM8 4v6h8V4M8 20v-6h8v6',datenschutz:'M12 2 21 6v6c0 5-9 10-9 10S3 17 3 12V6zM12 7v8',logout:'M10 3H3v18h7M8 12h14M17 7l5 5-5 5'};
    function icon(key){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',iconPaths[key]||iconPaths.logs);svg.append(path);return svg}
    function decorateUserAdmin(){
      const vehicle=menu.querySelector('[data-page="fahrzeuge"]');
      if(vehicle&&!vehicle.querySelector('svg'))vehicle.prepend(icon('fahrzeuge'));
      if(vehicle&&location.pathname.endsWith('/fahrzeuge.html')){vehicle.classList.add('active-page');vehicle.setAttribute('aria-current','page');}
      const backup=menu.querySelector('[data-page="backup"]');
      if(backup&&!backup.querySelector('svg'))backup.prepend(icon('backup'));
      const link=menu.querySelector('[data-page="benutzer"]');
      if(!link)return;
      if(!link.querySelector('svg'))link.prepend(icon('benutzer'));
      const active=window.location.pathname.endsWith('/benutzer.html');
      link.classList.toggle('active-page',active);
      if(active)link.setAttribute('aria-current','page');
    }
    decorateUserAdmin();
    new MutationObserver(decorateUserAdmin).observe(menu,{childList:true,subtree:true});
    const buttons=[...menu.querySelectorAll('button')];
    const current=window.location.pathname.split('/').pop()||'index.html';
    buttons.forEach(button=>{
      const action=button.getAttribute('onclick')||'';
      let key=button.dataset.page;
      if(!key){if(action.includes('goToProfile')||button.classList.contains('active-page')&&current==='profil.html')key='profil';else if(action.includes('goToHome'))key='home';else if(action.includes('goToKabellager'))key='index';else if(action.includes('goToKabelReport'))key='kabelreport';else if(action.includes('goToBaustellen'))key='baustellen';else if(action.includes('logout'))key='logout';}
      if(key)button.dataset.page=key;
      const label=key==='logs'?'Protokoll':key==='logout'?'Abmelden':button.textContent.trim();
      button.replaceChildren(icon(key),document.createTextNode(label));button.type='button';
      const active=(key==='kabelreport'?'kabel-report.html':key+'.html')===current;
      button.classList.toggle('active-page',active);if(active)button.setAttribute('aria-current','page');
    });
    // Keep the original nodes and inline display values used by role checks.
    const report=menu.querySelector('[data-page="kabelreport"]');
    const archive=menu.querySelector('[data-page="archiv"]');
    const works=menu.querySelector('[data-page="baustellen"]');
    if(works&&report)menu.insertBefore(works,report);
    if(archive&&report)menu.insertBefore(archive,report);
    if(!menu.querySelector('[data-page="fahrzeuge"]')){const vehicle=document.createElement('a');vehicle.href='fahrzeuge.html';vehicle.dataset.page='fahrzeuge';vehicle.textContent='Fahrzeuge';vehicle.style.display='none';menu.insertBefore(vehicle,report||menu.querySelector('[data-page="profil"]'));decorateUserAdmin();}
    // Existing vehicle buttons use the same position as dynamically added links.
    const vehicle=menu.querySelector('[data-page="fahrzeuge"]');
    if(vehicle&&report)menu.insertBefore(vehicle,report);
    const section=document.createElement('div');section.className='nt-section';section.textContent='VERWALTUNG';
    const firstAdmin=report||menu.querySelector('[data-page="logs"], [data-page="profil"]');if(firstAdmin)menu.insertBefore(section,firstAdmin);
    const overview=document.createElement('a');overview.href='meine-uebersicht.html';overview.append(icon('uebersicht'),document.createTextNode('Meine Übersicht'));
    if(current==='meine-uebersicht.html'){overview.classList.add('active-page');overview.setAttribute('aria-current','page')}
    const profileButton=menu.querySelector('[data-page="profil"]');menu.insertBefore(overview,profileButton||menu.querySelector('.logout-safe'));
    const privacy=document.createElement('a');privacy.href='datenschutz.html';privacy.append(icon('datenschutz'),document.createTextNode('Datenschutz'));
    if(current==='datenschutz.html'){privacy.classList.add('active-page');privacy.setAttribute('aria-current','page')}
    const logout=menu.querySelector('.logout-safe');menu.insertBefore(privacy,logout);
    const helpLink=document.createElement('a');helpLink.href='hilfe.html';
    const helpIcon=document.createElementNS('http://www.w3.org/2000/svg','svg');helpIcon.setAttribute('viewBox','0 0 24 24');helpIcon.setAttribute('aria-hidden','true');helpIcon.innerHTML='<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4M12 17h.01"/>';
    helpLink.append(helpIcon,document.createTextNode('Hilfe'));
    if(current==='hilfe.html'){helpLink.classList.add('active-page');helpLink.setAttribute('aria-current','page')}
    menu.insertBefore(helpLink,privacy);
    const close=document.createElement('button');close.type='button';close.className='nt-close';close.innerHTML='<span>Netzbau Tafers</span><span aria-hidden="true">✕</span>';close.setAttribute('aria-label','Menü schliessen');menu.prepend(close);
    let previousFocus=null;
    const backgroundNodes=()=>[...host.children].filter(node=>node!==menu&&node!==backdrop);
    const inertBefore=new Map();
    function sync(){
      const visible=mobile.matches?body.classList.contains('nt-nav-mobile-open'):!body.classList.contains('nt-nav-collapsed');
      toggle.setAttribute('aria-expanded',String(visible));menu.inert=!visible;
      const modal=mobile.matches&&visible;
      if(modal){for(const node of backgroundNodes()){if(!inertBefore.has(node))inertBefore.set(node,node.inert);node.inert=true}}
      else{for(const [node,value]of inertBefore)node.inert=value;inertBefore.clear()}
    }
    window.closeMenu=function(){const wasOpen=body.classList.contains('nt-nav-mobile-open');body.classList.remove('nt-nav-mobile-open');menu.classList.remove('open');sync();if(wasOpen&&previousFocus?.isConnected)previousFocus.focus()};
    window.toggleMenu=function(event){event?.stopPropagation();if(mobile.matches){const opening=!body.classList.contains('nt-nav-mobile-open');if(opening)previousFocus=document.activeElement;body.classList.toggle('nt-nav-mobile-open',opening);sync();if(opening)close.focus();else previousFocus?.focus()}else{body.classList.toggle('nt-nav-collapsed');try{localStorage.setItem('lager-navigation-collapsed',String(body.classList.contains('nt-nav-collapsed')))}catch(_){}sync()}};
    toggle.addEventListener('click',window.toggleMenu);close.addEventListener('click',()=>window.closeMenu());backdrop.addEventListener('click',()=>window.closeMenu());
    document.addEventListener('keydown',event=>{
      if(!mobile.matches||!body.classList.contains('nt-nav-mobile-open'))return;
      if(event.key==='Escape'){event.preventDefault();window.closeMenu()}
      if(event.key==='Tab'){const focusable=[...menu.querySelectorAll('button,a[href]')].filter(node=>!node.disabled&&node.getClientRects().length);const first=focusable[0],last=focusable.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}}
    });
    mobile.addEventListener('change',()=>window.closeMenu());
    if(app){const sessionSync=()=>{const hidden=getComputedStyle(app).display==='none';body.classList.toggle('nt-session-hidden',hidden);if(hidden)window.closeMenu()};new MutationObserver(sessionSync).observe(app,{attributes:true,attributeFilter:['style','class']});sessionSync()}
    sync();
    window.LagerAccess?.apply();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();




