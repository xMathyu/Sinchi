// Metro en monorepo.
//
// `expo/metro-config` ya detecta el workspace y anade `packages/*` a las rutas de
// resolucion, asi que casi todo esto es innecesario. Lo unico que se conserva es
// `watchFolders`, para que tocar `@sinchi/shared` recompile la app.
//
// Antes esto tambien ponia `resolver.disableHierarchicalLookup = true`. Lo marco
// `expo-doctor`: con las versiones actuales rompe la resolucion en vez de
// arreglarla, porque impide subir por el arbol de node_modules — que es
// exactamente como se resuelve un paquete hoisteado a la raiz del monorepo.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);
config.watchFolders = [workspaceRoot];

module.exports = config;
