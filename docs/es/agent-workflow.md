# Trabajo con agentes

[English](../agent-workflow.md) | [简体中文](../zh/agent-workflow.md) | [繁體中文](../zh-tw/agent-workflow.md) | [日本語](../ja/agent-workflow.md) | Español | [Deutsch](../de/agent-workflow.md) | [Índice de documentación](README.md)

Abre primero una carpeta de trabajo en la aplicación de escritorio. El Agent Gateway local consulta archivos, objetos y tablas de datos mediante identificadores estables y revisiones. De forma predeterminada permite leer y proponer cambios, que se revisan en Tano antes de aplicarlos. Para usar la escritura directa de Markdown de versiones anteriores debes indicar expresamente `--access write`. Consulta [Agent Gateway v1](../zh/agent-gateway.md) (en chino simplificado) para configurar el alcance de los permisos, usar el SDK, revisar cambios en varios archivos y consultar los comprobantes de las operaciones.

```sh
npm run mcp:build
node apps/mcp/dist/tano-mcp.cjs --workspace /path/to/notes --data-dir /path/to/tano-app-data
```

El servidor MCP requiere Node.js 24.12 o posterior. Usa las rutas del espacio de trabajo y de los datos de la aplicación que aparecen en el panel MCP de escritorio. Los datos de la aplicación deben estar fuera del espacio de trabajo. La aplicación de escritorio y el servidor MCP deben usar el mismo directorio de datos.

Al actualizar un archivo, incluye el hash SHA-256 devuelto por una lectura anterior. Si el archivo ha cambiado desde entonces, el servidor rechaza la escritura. Los registros de actividad se guardan en los datos de la aplicación y el contenido permanece en los archivos Markdown. El nombre que proporciona un cliente sirve como etiqueta y carece de valor como prueba de identidad de una persona o un modelo. El servidor stdio se limita al acceso local por MCP, sin ejecución de comandos remotos ni colaboración en red en tiempo real.
