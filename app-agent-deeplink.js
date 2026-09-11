document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  if (params.get('register') !== 'agent') return;

  const role = document.getElementById('registerRole');
  const modal = document.getElementById('registerModal');
  if (role) role.value = 'agent';
  if (modal) modal.classList.remove('hidden');

  const cleanUrl = `${window.location.pathname}${window.location.hash || ''}`;
  window.history.replaceState({}, '', cleanUrl);
});
