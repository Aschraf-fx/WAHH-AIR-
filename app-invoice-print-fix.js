/* Targeted fix: print only the rendered invoice in a clean document.
   This avoids the existing page-level @media print rules that can produce a blank preview. */
(function () {
  const button = document.getElementById('printInvoiceBtn');
  if (!button) return;

  button.addEventListener('click', function (event) {
    // Run before the old window.print() click handler and stop it.
    event.preventDefault();
    event.stopImmediatePropagation();

    const source = document.getElementById('invoicePrintArea');
    if (!source || !source.innerHTML.trim()) {
      if (typeof toast === 'function') toast('Invoice belum dimuatkan.', 'warning');
      return;
    }

    const invoiceNo = source.querySelector('.invoice-title p')?.textContent?.trim() || 'WAHH-AIR-Invoice';
    const printWindow = window.open('', '_blank', 'width=1000,height=800');
    if (!printWindow) {
      if (typeof toast === 'function') toast('Popup disekat. Benarkan pop-up untuk print invoice.', 'warning');
      return;
    }

    // Keep the invoice content unchanged, except use the exact current WAHH AIR raster logo.
    const invoiceHtml = source.innerHTML.replaceAll('assets/logo.svg', 'assets/logo.jpg');
    const baseUrl = `${window.location.origin}/`;

    printWindow.document.open();
    printWindow.document.write(`<!doctype html>
<html lang="ms">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <base href="${baseUrl}">
  <title>${invoiceNo}</title>
  <style>
    *{box-sizing:border-box}
    html,body{margin:0;padding:0;background:#fff;color:#10213f;font-family:Arial,Helvetica,sans-serif}
    body{padding:24px}
    .invoice-paper{width:100%;max-width:794px;margin:0 auto;background:#fff;padding:28px}
    .invoice-head{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;border-bottom:2px solid #071b49;padding-bottom:20px}
    .invoice-head img{width:100px;height:100px;object-fit:contain}
    .invoice-title{text-align:right}.invoice-title h1{margin:0;color:#071b49;font-size:25px}.invoice-title p{margin:6px 0 0;color:#667085}
    .invoice-meta{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:22px 0}
    .invoice-meta .box{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px}
    .invoice-meta span{display:block;color:#667085;font-size:12px;margin-bottom:4px}
    .table-wrap{width:100%;overflow:visible;border:1px solid #e2e8f0;border-radius:10px}
    .data-table{width:100%;border-collapse:collapse;min-width:0;background:#fff}
    .data-table th,.data-table td{padding:10px 11px;border-bottom:1px solid #edf1f5;text-align:left;font-size:12px;vertical-align:middle;white-space:normal}
    .data-table th{background:#f8fafc;color:#475467;font-size:11px;text-transform:uppercase;letter-spacing:.03em}
    .data-table tr:last-child td{border-bottom:0}.data-table .num{text-align:right}
    .invoice-total{width:100%;max-width:380px;margin-left:auto;margin-top:18px}
    .total-row{display:flex;justify-content:space-between;gap:20px;font-size:13px;padding:5px 0}
    .total-row.grand{border-top:1px dashed #cbd5e1;padding-top:10px;margin-top:4px;font-size:15px;font-weight:700;color:#071b49}
    .invoice-foot{border-top:1px solid #e2e8f0;margin-top:32px;padding-top:14px;text-align:center;font-size:11px;color:#667085}
    @page{size:A4;margin:12mm}
    @media print{html,body{width:100%;background:#fff}body{padding:0}.invoice-paper{max-width:none;padding:0;margin:0}.table-wrap{overflow:visible}}
  </style>
</head>
<body>
  <main class="invoice-paper">${invoiceHtml}</main>
  <script>
    window.addEventListener('load', function () {
      var imgs = Array.from(document.images);
      Promise.all(imgs.map(function(img){
        if (img.complete) return Promise.resolve();
        return new Promise(function(resolve){ img.onload = img.onerror = resolve; });
      })).then(function(){
        setTimeout(function(){ window.print(); }, 150);
      });
    });
  <\/script>
</body>
</html>`);
    printWindow.document.close();
  }, true);
})();
