# SiGPo — Notas de proyecto

## Reglas de trabajo (pedidas por Anneris)
- **No rellenar los huecos con suposiciones, confirmar siempre.**
- Nunca usar Python/sed para reconstruir archivos — solo el tool Edit con bloques exactos ya leídos.
- Siempre leer antes de editar. Después de cada Edit, verificar con grep/Read.
- Un cambio por commit.

## Infraestructura (NO volver a preguntar)
- **GitHub Pages publica desde la rama `desarrollo-36`.** Es la rama de producción en vivo. NO es `main`. Pushear a `desarrollo-36` pone los cambios en vivo.
- **Trabajo actual en la rama `desarrollo-37`** (copia de `desarrollo-36`). Acá se desarrolla y prueba sin afectar producción hasta que se decida mergear/publicar.
