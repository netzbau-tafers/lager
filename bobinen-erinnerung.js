/* Shared, authenticated in-app reminder. Acknowledgement belongs to one usage timestamp. */
(() => {
  'use strict';
  const WAIT = 48 * 60 * 60 * 1000;
  const millis = value => value && typeof value.toMillis === 'function' ? value.toMillis() : NaN;
  const eligible = (b, uid, now = Date.now()) => b.status === 'In Gebrauch' &&
    b.inGebrauchVonUid === uid && Number.isFinite(millis(b.inGebrauchAm)) &&
    now - millis(b.inGebrauchAm) >= WAIT &&
    b.erinnerungGelesenFuer !== String(millis(b.inGebrauchAm));
  let user = null, unsubscribe = null, records = [], active = null, timer = null;
  const db = firebase.firestore();
  const style = document.createElement('style');
  style.textContent = `#bobinen-erinnerung{position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box}#bobinen-erinnerung section{background:white;color:#172033;border-radius:16px;padding:24px;width:100%;max-width:460px;max-height:85vh;overflow:auto;box-shadow:0 16px 60px #0004;font:16px/1.5 Arial,sans-serif}#bobinen-erinnerung h2{font-size:21px;margin:0 0 12px}#bobinen-erinnerung dl{display:grid;grid-template-columns:130px 1fr;gap:8px;margin:18px 0}#bobinen-erinnerung dt{font-weight:bold}#bobinen-erinnerung dd{margin:0;overflow-wrap:anywhere}#bobinen-erinnerung button{background:#1565c0;color:white;border:0;border-radius:9px;padding:12px 18px;font:inherit;cursor:pointer}#bobinen-erinnerung a{color:#1565c0;display:inline-block;margin:0 12px 12px 0}#bobinen-erinnerung .error{color:#b71c1c}@media(max-width:400px){#bobinen-erinnerung dl{grid-template-columns:1fr;gap:3px}#bobinen-erinnerung dd{margin-bottom:8px}}`;
  document.head.append(style);
  function remove() {
    if(active) { active.element.remove(); active = null; }
  }
  function check() {
    clearTimeout(timer);
    if(!user || document.visibilityState === 'hidden') return;
    if(active) {
      const current = records.find(r => r.id === active.id);
      if(!current || !eligible(current.data(), user.uid) || millis(current.data().inGebrauchAm) !== active.started) remove();
    }
    if(!active) {
      const next = records.find(r => eligible(r.data(), user.uid));
      if(next) show(next);
    }
    timer = setTimeout(check, 30000);
  }
  function show(record) {
    const b = record.data(), started = millis(b.inGebrauchAm);
    const element = document.createElement('div');
    element.id = 'bobinen-erinnerung';
    element.innerHTML = '<section role="dialog" aria-modal="true" aria-labelledby="bobinen-erinnerung-title"><h2 id="bobinen-erinnerung-title">Erinnerung: Bobine noch in Gebrauch</h2><p class="reminder-intro"></p><dl></dl><p>Bitte prüfe, ob die Bobine noch benötigt wird. Wenn sie zurück im Lager ist, buche sie zurück. Ist das Kabel vollständig eingezogen, lösche die Bobine aus dem Kabellager.</p><a href="index.html">Zum Kabellager</a><br><button type="button">Gelesen und schliessen</button><p class="error" role="status"></p></section>';
    const usedBy = b.inGebrauchVonName || b.inGebrauchVonEmail || (user && (user.displayName || user.email)) || 'Unbekannter Benutzer';
    element.querySelector('.reminder-intro').textContent = 'Diese Bobine wurde von ' + usedBy + ' auf „In Gebrauch“ gesetzt und ist seit mindestens 48 Stunden in diesem Status.';
    const list = element.querySelector('dl');
    for(const [label,value] of [['Nummer',b.nummer],['Kabeltyp',b.typ],['Länge',b.laenge ? b.laenge + ' m' : ''],['Baustelle',b.baustelle],['In Gebrauch seit',new Date(started).toLocaleString('de-CH')]]) {
      const dt = document.createElement('dt'), dd = document.createElement('dd');
      dt.textContent = label; dd.textContent = value || 'Nicht erfasst'; list.append(dt,dd);
    }
    active = {id:record.id, started, element};
    const button = element.querySelector('button');
    button.onclick = async () => {
      const uid = user && user.uid;
      button.disabled = true;
      try {
        await db.runTransaction(async transaction => {
          const latest = await transaction.get(record.ref);
          if(!latest.exists || !user || user.uid !== uid) return;
          const current = latest.data();
          if(!eligible(current,uid) || millis(current.inGebrauchAm) !== started) return;
          transaction.update(record.ref, {
            erinnerungGelesenFuer: String(started),
            erinnerungGelesenAm: firebase.firestore.FieldValue.serverTimestamp()
          });
        });
        records = records.filter(r => r.id !== record.id);
        remove();
        check();
        // Wait for fresh server state; do not redisplay from the old snapshot.
      } catch(error) {
        console.error('Bobinen-Erinnerung konnte nicht bestätigt werden:', error);
        element.querySelector('.error').textContent = 'Die Bestätigung konnte nicht gespeichert werden. Bitte versuche es erneut.';
        button.disabled = false;
      }
    };
    document.body.append(element); button.focus();
  }
  firebase.auth().onAuthStateChanged(nextUser => {
    if(unsubscribe) unsubscribe();
    clearTimeout(timer); remove(); records = []; user = nextUser;
    if(!user) return;
    unsubscribe = db.collection('bobinen').where('inGebrauchVonUid','==',user.uid).onSnapshot(snapshot => {
      records = snapshot.docs; check();
    },error => console.error('Bobinen-Erinnerungen konnten nicht geladen werden:',error));
  });
  document.addEventListener('visibilitychange',check);
  window.addEventListener('focus',check);
})();
