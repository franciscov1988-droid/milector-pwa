# Mi Lector — App web instalable (PWA) offline

Lector de EPUB **offline** e **instalable** (con icono). Tus libros viven en el
propio dispositivo (IndexedDB); además puedes:

- **Instalarla** como app (icono en el teléfono o la laptop).
- Leer **sin conexión** una vez cargada.
- Ver las **portadas reales** de cada libro.
- **Respaldo en JSON**: exportar un archivo con tus libros + progreso + marcadores
  para pasarlos a otro dispositivo, e importarlo allá.
- **Respaldo automático en Google Drive** (opcional): cada EPUB que agregues y tu
  progreso se suben a la carpeta “Mi Lector” de tu Drive.

---

## 1. Ejecutar / compilar

Node.js 18+:

```bash
npm install
npm run dev        # desarrollo en http://localhost:5173
npm run build      # genera la carpeta dist/ para publicar
```

Publica `dist/` en Netlify (el `netlify.toml` ya está listo) o GitHub Pages.
Para instalarla como app hace falta **HTTPS** (Netlify lo da automáticamente).

---

## 2. Uso

- **Agregar libros:** botón **＋ Agregar EPUB** (puedes elegir varios a la vez).
- **Leer:** toca un libro. Bordes para pasar página, flechas del teclado, centro
  para ajustes. Ajustes de tema, fuente, tamaño, interlineado, alineación y márgenes.
- **Instalar:** desde el menú **⋯ → Instalar app**, o el aviso del navegador.
- **Eliminar:** pasa el cursor sobre un libro y usa el ícono de papelera.

---

## 3. Respaldo en JSON (sin cuentas)

Menú **⋯**:
- **Exportar respaldo (JSON):** elige “Todo” (incluye los EPUB) o “Solo datos”
  (progreso y marcadores). Se descarga un `.json`.
- **Restaurar respaldo (JSON):** selecciona ese archivo en otro dispositivo.

Es la forma más simple de trasladar tu biblioteca sin usar internet.

---

## 4. Respaldo automático en Google Drive (opcional)

Mantiene una copia en la nube sin afectar la lectura offline.

Necesitas un **Client ID de OAuth tipo “Aplicación web”** (Google Cloud Console →
Credenciales), con tu URL en **Orígenes autorizados de JavaScript** (sin barra
final) y la **Google Drive API** habilitada.

Luego, en la app: menú **⋯ → Conectar Google Drive**, pega el Client ID y acepta.
Desde ahí:
- Cada EPUB que agregues se **sube solo** a la carpeta “Mi Lector”.
- Tu **progreso y marcadores** se respaldan automáticamente.
- **Restaurar de Drive** baja a este dispositivo los libros que falten.

Usa el scope `drive.file` (no requiere verificación de Google) y el mismo formato
de progreso que la app Android: el libro se identifica por el hash del archivo, así
que empata con tus otras instalaciones.

> Si no hay conexión, la app sigue funcionando; el respaldo se reintenta luego.
