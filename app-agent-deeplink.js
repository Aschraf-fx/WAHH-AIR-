document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  const requestedRole = params.get('register');
  if (!['agent','rider'].includes(requestedRole)) return;

  const role = document.getElementById('registerRole');
  const modal = document.getElementById('registerModal');
  if (role) role.value = requestedRole;
  if (modal) modal.classList.remove('hidden');

  const cleanUrl = `${window.location.pathname}${window.location.hash || ''}`;
  window.history.replaceState({}, '', cleanUrl);
});
