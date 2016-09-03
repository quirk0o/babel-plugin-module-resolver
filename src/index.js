import path from 'path';
import resolve from 'resolve';
import glob from 'glob';
import mapToRelative from './mapToRelative';
import { toLocalPath, toPosixPath } from './utils';

function createAliasFileMap(pluginOpts) {
    const alias = pluginOpts.alias || {};
    return Object.keys(alias).reduce((memo, expose) => (
        Object.assign(memo, {
            [expose]: alias[expose]
        })
    ), {});
}

function replaceExt(p, ext) {
    const filename = path.basename(p, path.extname(p)) + ext;
    return path.join(path.dirname(p), filename);
}

const defaultBabelExtensions = ['.js', '.jsx', '.es', '.es6'];

export function mapModule(source, file, pluginOpts) {
    // Do not map source starting with a dot
    if (source[0] === '.') {
        return null;
    }

    // Search the file under the custom root directories
    const rootDirs = pluginOpts.root || [];
    for (let i = 0; i < rootDirs.length; i++) {
        try {
            // check if the file exists (will throw if not)
            const extensions = pluginOpts.extensions || defaultBabelExtensions;
            const resolvedSourceFile = resolve.sync(`./${source}`, { basedir: path.resolve(rootDirs[i]), extensions });
            const realSourceFileExtension = path.extname(resolvedSourceFile);
            const sourceFileExtension = path.extname(source);
            // map the source and keep its extension if the import/require had one
            const ext = realSourceFileExtension === sourceFileExtension ? realSourceFileExtension : '';
            return toLocalPath(toPosixPath(replaceExt(mapToRelative(file, resolvedSourceFile), ext)));
        } catch (e) {
            // empty...
        }
    }

    // The source file wasn't found in any of the root directories. Lets try the alias
    const aliasMapping = createAliasFileMap(pluginOpts);
    const moduleSplit = source.split('/');

    let aliasPath;
    while (moduleSplit.length) {
        const m = moduleSplit.join('/');
        if ({}.hasOwnProperty.call(aliasMapping, m)) {
            aliasPath = aliasMapping[m];
            break;
        }
        moduleSplit.pop();
    }

    // no alias mapping found
    if (!aliasPath) {
        return null;
    }

    // remove legacy "npm:" prefix for npm packages
    aliasPath = aliasPath.replace(/^(npm:)/, '');
    const newPath = source.replace(moduleSplit.join('/'), aliasPath);

    // alias to npm module don't need relative mapping
    if (aliasPath[0] !== '.') {
        return newPath;
    }
    // relative alias
    return toLocalPath(toPosixPath(mapToRelative(file, newPath)));
}


export default ({ types: t }) => {
    function isImportMethodCall(methodName, nodePath) {
        if (t.isIdentifier(nodePath.node.callee, { name: methodName })) {
            return true;
        }
        return t.isMemberExpression(nodePath.node.callee) &&
            t.isIdentifier(nodePath.node.callee.object, { name: methodName });
    }

    const isRequireCall = isImportMethodCall.bind(null, 'require');
    const isProxyquireCall = (nodePath) => {
        if (isImportMethodCall('proxyquire', nodePath)) {
            return true;
        }

        if (!t.isMemberExpression(nodePath.node.callee) || !t.isIdentifier(nodePath.node.callee.property,
                { name: 'load' }) || !t.isCallExpression(nodePath.node.callee.object)) {
            return false;
        }

        let proxyquireCalleeObject = false;
        nodePath.traverse({
            CallExpression: {
                exit(childPath) {
                    proxyquireCalleeObject = isProxyquireCall(childPath);
                }
            }
        });
        return proxyquireCalleeObject;
    };

    function transformRequireCall(nodePath, state) {
        if (!isRequireCall(nodePath)) return;

        const moduleArg = nodePath.node.arguments[0];
        if (moduleArg && moduleArg.type === 'StringLiteral') {
            const modulePath = mapModule(moduleArg.value, state.file.opts.filename, state.opts);
            if (modulePath) {
                nodePath.replaceWith(t.callExpression(
                    nodePath.node.callee, [t.stringLiteral(modulePath)]
                ));
            }
        }
    }

    function transformProxyquireCall(nodePath, state) {
        if (!isProxyquireCall(nodePath)) return;

        const moduleArg = nodePath.node.arguments[0];

        if (moduleArg && moduleArg.type === 'StringLiteral') {
            const modulePath = mapModule(moduleArg.value, state.file.opts.filename, state.opts);
            if (modulePath) {
                const stubsArg = nodePath.node.arguments[1];

                if (stubsArg && t.isObjectExpression(stubsArg)) {
                    const resolvedStubs = stubsArg;

                    resolvedStubs.properties = stubsArg.properties.map(property => {
                        const stubModule = property.key;
                        if (stubModule && stubModule.type === 'StringLiteral') {
                            const stubModulePath = mapModule(stubModule.value, modulePath, state.opts);
                            if (stubModulePath) {
                                return t.objectProperty(t.stringLiteral(stubModulePath), property.value);
                            }
                        }
                        return property;
                    });
                    nodePath.replaceWith(t.callExpression(
                        nodePath.node.callee, [
                            t.stringLiteral(modulePath),
                            resolvedStubs,
                            ...nodePath.node.arguments.slice(2)
                        ]
                    ));
                } else {
                    nodePath.replaceWith(t.callExpression(
                        nodePath.node.callee, [
                            t.stringLiteral(modulePath),
                            ...nodePath.node.arguments.slice(1)
                        ]
                    ));
                }
            }
        }
    }

    function transformMethodCall(nodePath, state) {
        return transformRequireCall(nodePath, state) || transformProxyquireCall(nodePath, state);
    }

    function transformImportCall(nodePath, state) {
        const moduleArg = nodePath.node.source;
        if (moduleArg && moduleArg.type === 'StringLiteral') {
            const modulePath = mapModule(moduleArg.value, state.file.opts.filename, state.opts);
            if (modulePath) {
                nodePath.replaceWith(t.importDeclaration(
                    nodePath.node.specifiers,
                    t.stringLiteral(modulePath)
                ));
            }
        }
    }

    return {
        manipulateOptions(babelOptions) {
            const findPluginOptions = babelOptions.plugins.find(plugin => plugin[0] === this)[1];
            if (findPluginOptions.root) {
                findPluginOptions.root = findPluginOptions.root.reduce((resolvedDirs, dirPath) => {
                    if (glob.hasMagic(dirPath)) {
                        return resolvedDirs.concat(glob.sync(dirPath));
                    }
                    return resolvedDirs.concat(dirPath);
                }, []);
            }
        },
        visitor: {
            CallExpression: {
                exit(nodePath, state) {
                    return transformMethodCall(nodePath, state);
                }
            },
            ImportDeclaration: {
                exit(nodePath, state) {
                    return transformImportCall(nodePath, state);
                }
            }
        }
    };
};
