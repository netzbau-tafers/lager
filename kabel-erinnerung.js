// Reminder shown on the next page opening; closing never changes cable data.
(function(){
  const REMINDER_AGE_MS = 72 * 60 * 60 * 1000;
  let unsubscribe = null;
  let checked = false;
  let dialog = null;

  function timestampMillis(value){
    if(!value){ return NaN; }
    if(typeof value.toMillis === "function"){ return value.toMillis(); }
    if(typeof value.seconds === "number"){ return value.seconds * 1000; }
    return new Date(value).getTime();
  }

  function isDue(bobine, userUid, now){
    const started = timestampMillis(bobine.inGebrauchAm);
    return bobine.status === "In Gebrauch" &&
      bobine.inGebrauchVonUid === userUid &&
      Number.isFinite(started) && now - started >= REMINDER_AGE_MS;
  }

  function showReminder(docs){
    dialog = document.createElement("dialog");
    dialog.className = "cable-reminder-dialog";
    dialog.setAttribute("aria-labelledby", "cableReminderTitle");
    const title = document.createElement("h2");
    title.id = "cableReminderTitle";
    title.textContent = "Kabel weiterhin in Gebrauch?";
    const intro = document.createElement("p");
    intro.textContent = "Diese Kabel wurden vor mindestens 72 Stunden von dir herausgeschrieben. Ist der Status noch korrekt? Falls nicht, buche das Kabel zurück ins Lager oder lösche die Bobine, wenn das Kabel vollständig eingezogen wurde.";
    dialog.append(title, intro);
    docs.forEach(doc => {
      const b = doc.data();
      const card = document.createElement("div");
      card.className = "cable-reminder-card";
      const started = new Date(timestampMillis(b.inGebrauchAm));
      const date = new Intl.DateTimeFormat("de-CH", {
        timeZone:"Europe/Zurich", day:"2-digit", month:"2-digit", year:"numeric",
        hour:"2-digit", minute:"2-digit", hourCycle:"h23"
      }).format(started);
      [["Nummer",b.nummer],["Länge",b.laenge],["Baustelle",b.baustelle],["Herausgeschrieben am",date]].forEach(([label,value]) => {
        const row = document.createElement("p");
        const strong = document.createElement("strong");
        strong.textContent = label + ": ";
        row.append(strong, document.createTextNode(String(value == null || value === "" ? "–" : value)));
        card.append(row);
      });
      const link = document.createElement("a");
      link.className = "cable-reminder-link";
      link.href = "index.html?kabel=" + encodeURIComponent(doc.id);
      link.textContent = "Kabel öffnen";
      card.append(link);
      dialog.append(card);
    });
    const form = document.createElement("form");
    form.method = "dialog";
    const close = document.createElement("button");
    close.type = "submit";
    close.className = "back";
    close.textContent = "Schliessen";
    close.autofocus = true;
    form.append(close);
    dialog.append(form);
    dialog.addEventListener("close", () => { dialog.remove(); dialog = null; }, {once:true});
    document.body.append(dialog);
    dialog.showModal();
  }

  auth.onAuthStateChanged(user => {
    if(unsubscribe){ unsubscribe(); unsubscribe = null; }
    if(dialog){ dialog.close(); }
    checked = false;
    if(!user){ return; }
    unsubscribe = firebase.firestore().collection("bobinen")
      .where("inGebrauchVonUid", "==", user.uid)
      .onSnapshot(snapshot => {
        // Wait for current server data rather than a potentially stale offline cache.
        if(checked || snapshot.metadata.fromCache){ return; }
        checked = true;
        const due = snapshot.docs.filter(doc => isDue(doc.data(), user.uid, Date.now()));
        // Opening a particular cable should go directly to that entry.
        if(due.length && !new URLSearchParams(window.location.search).has("kabel")){
          showReminder(due);
        }
      }, error => console.warn("Kabel-Erinnerung konnte nicht geladen werden:", error));
  });
})();
