(function(){
  const s=document.createElement('script');
  s.src='app-admin-events.js?v=20260912-1437';
  s.onload=()=>init();
  s.onerror=()=>{ console.error('Gagal memuatkan modul Pengurusan Event.'); init(); };
  document.head.appendChild(s);
})();