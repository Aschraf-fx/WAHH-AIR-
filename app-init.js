(function(){
  const eventScript=document.createElement('script');
  eventScript.src='app-admin-events.js?v=20260912-1437';

  eventScript.onload=()=>{
    const ledgerScript=document.createElement('script');
    ledgerScript.src='app-event-commission-ledger.js?v=20260912-1455';
    ledgerScript.onload=()=>{
      const financeScript=document.createElement('script');
      financeScript.src='app-event-finance-fix.js?v=20260912-1510';
      financeScript.onload=()=>init();
      financeScript.onerror=()=>{
        console.error('Gagal memuatkan pembetulan kewangan Event.');
        init();
      };
      document.head.appendChild(financeScript);
    };
    ledgerScript.onerror=()=>{
      console.error('Gagal memuatkan table Komisen Event / PIC Event.');
      const financeScript=document.createElement('script');
      financeScript.src='app-event-finance-fix.js?v=20260912-1510';
      financeScript.onload=()=>init();
      financeScript.onerror=()=>init();
      document.head.appendChild(financeScript);
    };
    document.head.appendChild(ledgerScript);
  };

  eventScript.onerror=()=>{
    console.error('Gagal memuatkan modul Pengurusan Event.');
    init();
  };

  document.head.appendChild(eventScript);
})();