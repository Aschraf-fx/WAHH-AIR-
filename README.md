# WAHH AIR! — GitHub Pages + Firebase Firestore

Aplikasi stok, bancuhan, rider dan keuntungan yang boleh sync antara telefon dan komputer.

## 1. Cipta Firebase project

1. Buka Firebase Console dan cipta project.
2. Tambah **Web App**.
3. Salin `firebaseConfig` yang diberi.
4. Buka `firebase-config.js` dan gantikan semua nilai `PASTE_...`.

## 2. Aktifkan Authentication

1. Firebase Console > Authentication > Get started.
2. Sign-in method > **Email/Password** > Enable.

## 3. Aktifkan Firestore

1. Firebase Console > Firestore Database > Create database.
2. Pilih lokasi terdekat yang tersedia.
3. Buka tab Rules.
4. Salin kandungan `firestore.rules`, kemudian Publish.

Rules ini memastikan setiap akaun hanya boleh baca/tulis datanya sendiri.

## 4. Upload ke GitHub

Upload fail berikut ke root repository:

- `index.html`
- `firebase-config.js`
- `firestore.rules`
- `README.md`

Jangan buang `firebase-config.js`. Firebase web config bukan password; keselamatan sebenar datang daripada Authentication dan Firestore Rules.

## 5. Hidupkan GitHub Pages

1. Repository > Settings > Pages.
2. Source: **Deploy from a branch**.
3. Branch: `main`, folder `/ (root)`.
4. Save.
5. Buka URL GitHub Pages yang diberikan.

## Data lama

Pada kali pertama akaun log masuk, jika Firestore masih kosong, data localStorage pada peranti itu akan dihantar ke Firestore secara automatik. Selepas itu, gunakan akaun sama pada semua peranti.

## Ujian penting

- Daftar akaun pada peranti pertama.
- Pastikan status menunjukkan `Semua data telah sync`.
- Log masuk akaun sama pada peranti kedua.
- Tambah stok pada satu peranti dan lihat perubahan muncul pada peranti lain.
