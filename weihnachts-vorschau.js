/* Lokale Weihnachtsvorschau – nur im aktuellen Tab des Hauptadministrators. */
(function(){
  'use strict';
  const STORAGE_KEY = 'lager-weihnachtsvorschau-tab';

  function isDecember(){
    return Number(new Intl.DateTimeFormat('en-US', {
      timeZone:'Europe/Zurich', month:'numeric'
    }).format(new Date())) === 12;
  }

  function mayPreview(user){
    return Boolean(user && window.LagerAccess && user.uid === window.LagerAccess.MASTER);
  }

  function previewEnabled(user){
    if(!mayPreview(user))return false;
    try{return window.sessionStorage.getItem(STORAGE_KEY) === user.uid;}
    catch(_){return false;}
  }

  function setPreviewEnabled(user,enabled){
    if(!mayPreview(user))return false;
    try{
      if(enabled)window.sessionStorage.setItem(STORAGE_KEY,user.uid);
      else window.sessionStorage.removeItem(STORAGE_KEY);
      return true;
    }catch(_){return false;}
  }

  window.LagerChristmasPreview = Object.freeze({
    isActive:user => isDecember() || previewEnabled(user),
    previewEnabled,
    setPreviewEnabled
  });
})();
