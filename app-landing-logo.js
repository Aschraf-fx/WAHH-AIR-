document.addEventListener('DOMContentLoaded', async () => {
  const targets = [
    document.querySelector('.topbar .brand img'),
    document.querySelector('#publicApp .hero-logo-card img')
  ].filter(Boolean);
  if (!targets.length) return;

  try {
    const parts = await Promise.all(
      Array.from({ length: 11 }, (_, i) =>
        fetch(`/assets/landing-logo/part-${String(i).padStart(2, '0')}.txt`, { cache: 'force-cache' })
          .then(response => {
            if (!response.ok) throw new Error('Logo asset unavailable');
            return response.text();
          })
      )
    );
    const fullResolutionLogo = `data:image/webp;base64,${parts.join('')}`;
    targets.forEach(img => { img.src = fullResolutionLogo; });
  } catch (error) {
    console.warn('Landing logo asset unavailable:', error);
  }
});
