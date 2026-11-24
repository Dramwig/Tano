# Desarrollo local

[English](../local-development.md) | [简体中文](../zh/local-development.md) | [繁體中文](../zh-tw/local-development.md) | [日本語](../ja/local-development.md) | Español | [Deutsch](../de/local-development.md) | [Índice de documentación](README.md)

Para configurar aplicaciones OAuth de proveedores externos, consulta la [guía de importación de cuentas](../account-import.md) (en inglés). Los pasos de compilación y verificación para móviles y tabletas están en la [guía de desarrollo móvil](../mobile.md) (en inglés).

Instala Node.js 24.12 o posterior, npm y la versión estable de Rust. Para desarrollar la aplicación de escritorio, instala también los [requisitos de Tauri 2](https://v2.tauri.app/start/prerequisites/) de tu plataforma. En Windows se necesitan C++ Build Tools, Windows SDK y WebView2. Ejecuta `powershell -File scripts/check-desktop.ps1` para comprobar el entorno.

Desde la raíz del repositorio, ejecuta estos comandos.

```sh
npm ci
npm run desktop
```

En Windows también puedes abrir `local-desktop.bat` con un doble clic. Comprueba la versión de Node.js y las herramientas de escritorio y ejecuta `npm install --no-audit --no-fund` antes de cada inicio. Así se sincronizan las dependencias nuevas o modificadas aunque exista `node_modules`. Se reutilizan las dependencias que coinciden con el archivo de bloqueo.

El comando inicia la aplicación de desarrollo con Vite y Tauri. La ventana principal permanece oculta hasta que se monta la interfaz de trabajo, también después de las recargas de Vite. El progreso de la instalación y la compilación aparece en la terminal. Si falla el inicio de la interfaz o pasan 30 segundos, aparece una pantalla de recuperación con un botón para recargar. Si la inicialización termina después del plazo, la pantalla de recuperación sigue visible.

Ambos métodos de inicio en Windows comprueban la versión de Node.js antes de instalar dependencias. La configuración de npm del repositorio también rechaza las versiones incompatibles. Si falla la comprobación, usa `node -v` y `where.exe node` para ver la versión activa y la ruta del ejecutable. Si utilizas nvm-windows, instala y activa Node.js 24.12 o posterior y vuelve a abrir la terminal o el iniciador.

Para probar la demo en el navegador, ejecuta `npm run dev` y abre `http://127.0.0.1:43841`. La demo guarda los datos en el navegador y carece de acceso a las carpetas de trabajo locales. El desarrollo de escritorio usa preferentemente el puerto 43842. Si está ocupado, `npm run desktop` y `local-desktop.bat` eligen otro puerto libre y muestran la dirección efectiva. Puedes ejecutar la demo y la aplicación de escritorio a la vez, siempre que el puerto 43841 esté libre al iniciar la demo.

El identificador de la aplicación de escritorio es `app.tano.local`. En Windows, los datos de la aplicación suelen estar en `%APPDATA%/app.tano.local`. Al configurar un agente, utiliza la ruta que aparece en el panel MCP de Tano. Los archivos Markdown y `.tano/` pueden trasladarse con el espacio de trabajo. Los índices, borradores y el estado de sesión se guardan en los datos de la aplicación.

Una vez instaladas las dependencias, puedes editar, buscar y conservar borradores sin conexión. Las imágenes remotas y las comprobaciones de actualizaciones configuradas explícitamente requieren conexión. Las compilaciones a partir del código fuente vienen sin un servidor de actualizaciones configurado.

Antes de publicar una versión, ejecuta `npm run check` y las comprobaciones nativas y de MCP que correspondan (`npm run test:native` y `npm run mcp:smoke`) según la guía de [validación local](../local-validation.md) (en inglés). En el desarrollo habitual, elige las comprobaciones que correspondan al cambio. Tras modificar el código Rust, ejecuta estos comandos.

```sh
cargo fmt --manifest-path crates/tano-native/Cargo.toml
cargo fmt --manifest-path apps/client/src-tauri/Cargo.toml
```
