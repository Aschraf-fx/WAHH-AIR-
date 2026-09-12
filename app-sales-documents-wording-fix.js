(function(){
  function cleanSalesDocumentWording(root=document){
    const depositPct=$('#sdDepositPct',root)?.closest('label');
    if(depositPct&&depositPct.childNodes[0]) depositPct.childNodes[0].textContent='Deposit (%) ';

    const depositDays=$('#sdDepositDays',root)?.closest('label');
    if(depositDays&&depositDays.childNodes[0]) depositDays.childNodes[0].textContent='Tempoh deposit (hari) ';
  }

  const previousRenderAdmin=window.renderAdmin;
  window.renderAdmin=async function(view,root){
    const result=await previousRenderAdmin(view,root);
    if(view==='sales-documents') cleanSalesDocumentWording(root);
    return result;
  };

  const observer=new MutationObserver(()=>{
    const root=$('#portalContent');
    if(root) cleanSalesDocumentWording(root);
  });
  const portal=$('#portalContent');
  if(portal) observer.observe(portal,{childList:true,subtree:true});
})();
