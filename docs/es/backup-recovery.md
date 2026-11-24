# Copias de seguridad y recuperación

[English](../backup-recovery.md) | [简体中文](../zh/backup-recovery.md) | [繁體中文](../zh-tw/backup-recovery.md) | [日本語](../ja/backup-recovery.md) | Español | [Deutsch](../de/backup-recovery.md) | [Índice de documentación](README.md)

Haz una copia de los archivos Markdown, los adjuntos y todo el directorio `.tano/`. El UUID del espacio de trabajo, las identidades de los archivos, los objetos, las relaciones y las reglas son datos originales que deben conservarse al trasladar el espacio.

Tano carece de copias automáticas y de funciones para importar, exportar o restaurar archivos de respaldo del espacio de trabajo. Si eliminas la carpeta fuera de Tano, la aplicación no podrá abrirla. Usa tu herramienta de copias de seguridad, el control de versiones o la papelera del sistema operativo para recuperar la carpeta y su contenido.

Si conservas la carpeta pero eliminas todo el directorio `.tano/`, Tano inicializa un espacio de trabajo con un UUID y unos identificadores de archivo nuevos al volver a abrirla. Un aviso indica que se han eliminado los metadatos originales, se han perdido los datos de los objetos y se ha reinicializado el proyecto. Los archivos Markdown y los adjuntos siguen disponibles. Para recuperar objetos, relaciones o reglas eliminados con `.tano/`, restaura una copia de seguridad. La reinicialización tampoco recupera los índices, borradores ni el estado de sesión del espacio anterior. Si solo faltan algunos metadatos de identidad, están dañados o son incompatibles, la apertura sigue bloqueada. Una sesión que ya esté abierta deja de escribir hasta que vuelvas a abrir e inicializar el espacio de trabajo.

Los diarios de borradores se guardan en los datos de la aplicación y permiten conservar cambios sin guardar tras reiniciarla. El espacio de trabajo requiere su propia copia de seguridad. Ante cambios externos se sigue aplicando la comparación del hash base y la fusión a tres bandas, con conservación de las dos versiones cuando hay un conflicto.
