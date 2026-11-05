# Mi Lector — App web instalable (PWA) con sincronización en Firebase

Lector de EPUB **offline** e **instalable**. Los libros viven en cada dispositivo
(IndexedDB) y, si activas la sincronización, tu **progreso** se comparte entre tus
dispositivos con **Firebase** (plan gratuito, sin tarjeta):

- **Progreso y marcadores → Firestore** (se sincronizan **en tiempo real**, sin botón).
  Lees en la PC y al abrir en el celular estás en la última página.
- **Inicio de sesión con correo y contraseña** (simple: sin Client ID ni pantallas de
  “app no verificada”).
- **Los archivos EPUB se guardan localmente** en cada dispositivo. Para tener un libro
  en varios: agrégalo en cada uno, o pásalos de una vez con **Exportar / Restaurar
  respaldo (JSON)**. La lectura es 100% offline.

---

## 1. Compilar y publicar

```bash
npm install
npm run dev        # desarrollo en http://localhost:5173
npm run build      # genera dist/ para publicar (Netlify o GitHub Pages)
```

Para instalarla como app hace falta **HTTPS** (Netlify y GitHub Pages lo dan).

---

## 2. Configurar Firebase (una sola vez)

### a) Crear el proyecto
1. Entra a `https://console.firebase.google.com` y crea un proyecto (o usa el que ya
   tienes, por ejemplo el de tu app de presupuesto).

### b) Registrar la app web
2. En el proyecto: **⚙️ Configuración del proyecto → Tus apps → icono Web (</>)**.
3. Ponle un apodo y registra la app. Firebase te mostrará un bloque
   **`firebaseConfig`** con `apiKey`, `projectId`, `appId`, etc. **Cópialo** (lo
   pegarás en la app).

### c) Activar los servicios (solo dos; NO necesitas Storage)
4. **Authentication → Comenzar → Correo electrónico/contraseña → Habilitar.**
5. **Firestore Database → Crear base de datos** (modo producción, región la más
   cercana, p. ej. `us`).

> No actives Storage. Esa parte pide tarjeta y esta versión no la usa: los libros se
> guardan localmente en cada dispositivo.

### d) Reglas de seguridad (para que cada quien vea solo lo suyo)
En **Firestore → Reglas**, pega esto y publica:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

### e) Autorizar tu dominio
6. **Authentication → Configuración → Dominios autorizados → Agregar dominio** y pon
   la URL donde abres la app, por ejemplo `lectorepub.netlify.app` o
   `franciscov1988-droid.github.io`. (`localhost` ya viene autorizado.)

---

## 3. Activar la sincronización en la app

1. Abre la app (en la PC o el celular), menú **⋯ → Activar sincronización**.
2. Pega el bloque **firebaseConfig** y guarda.
3. La primera vez, pulsa **Crear cuenta nueva** con tu correo y una contraseña
   (mínimo 6 caracteres). En los demás dispositivos usa **Entrar** con ese mismo
   correo y contraseña.

Listo. A partir de ahí:
- Lo que lees se guarda solo; al abrir el mismo libro en otro dispositivo, saltas a tu
  última página.
- Un ☁️ en la barra indica que la sincronización está activa.
- Para leer un libro en otro dispositivo, agrégalo ahí también (el mismo archivo) o
  pásalo con el respaldo JSON. Tu progreso ya estará guardado y se aplicará solo.

---

## 4. Sin Firebase también funciona

Si no activas la sincronización, la app funciona offline igual, y puedes mover tu
biblioteca con **⋯ → Exportar / Restaurar respaldo (JSON)**.

---

## 5. Notas

- El `firebaseConfig` es información pública (así lo diseña Firebase); no es un
  secreto. Las reglas de seguridad son las que protegen tus datos.
- Cada libro se identifica por el hash del archivo, así que el mismo EPUB en varios
  dispositivos comparte progreso. Para que empaten, deja que un dispositivo lo suba y
  en los demás ábrelo desde la biblioteca (se descarga solo).
- Plan gratuito de Firebase (Spark): suficiente para uso personal (Firestore 1 GB, de
  sobra para el progreso de miles de libros). No se usa Storage, así que no te pide
  tarjeta.
