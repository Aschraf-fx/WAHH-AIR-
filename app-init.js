(function(){
  const eventScript=document.createElement('script');
  eventScript.src='app-admin-events.js?v=20260912-1437';

  eventScript.onload=()=>{
    const ledgerScript=document.createElement('script');
    ledgerScript.src='app-event-commission-ledger.js?v=20260912-1455';
    ledgerScript.onload=()=>init();
    ledgerScript.onerror=()=>{
      console.error('Gagal memuatkan table Komisen Event / PIC Event.');
      init();
    };
    document.head.appendChild(ledgerScript);
  };

  eventScript.onerror=()=>{
    console.error('Gagal memuatkan modul Pengurusan Event.');
    init();
  };

  document.head.appendChild(eventScript);
})();