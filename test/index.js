/* eslint-env mocha */
import assert from 'assert';
import { transform } from 'babel-core'; // eslint-disable-line import/no-extraneous-dependencies
import plugin from '../src';

describe('module-resolver', () => {
    function testRequireImport(source, output, transformerOpts) {
        it('with a require statement', () => {
            const code = `var something = require("${source}");`;
            const result = transform(code, transformerOpts);

            assert.strictEqual(result.code, `var something = require("${output}");`);
        });

        it('with a proxyquire statement', () => {
            const code = `var something = proxyquire("${source}");`;
            const result = transform(code, transformerOpts);

            assert.strictEqual(result.code, `var something = proxyquire("${output}");`);
        });

        it('with a proxyquire with stubs statement', () => {
            const code = `var something = proxyquire("${source}", {});`;
            const result = transform(code, transformerOpts);

            assert.strictEqual(result.code, `var something = proxyquire("${output}", {});`);
        });

        it('with a proxyquire load statement', () => {
            const code = `var something = proxyquire.load("${source}");`;
            const result = transform(code, transformerOpts);

            assert.strictEqual(result.code, `var something = proxyquire.load("${output}");`);
        });

        it('with a proxyquire load chain statement', () => {
            const code = `var something = proxyquire.noCallThru().load("${source}");`;
            const result = transform(code, transformerOpts);

            assert.strictEqual(result.code, `var something = proxyquire.noCallThru().load("${output}");`);
        });

        it('with a non-proxyquire load statement', () => {
            const code = `var something = norequire.load("${source}");`;
            const result = transform(code, transformerOpts);

            assert.strictEqual(result.code, code);
        });

        it('with an import statement', () => {
            const code = `import something from "${source}";`;
            const result = transform(code, transformerOpts);

            assert.strictEqual(result.code, `import something from "${output}";`);
        });
    }

    describe('root', () => {
        const transformerOpts = {
            babelrc: false,
            plugins: [
                [plugin, {
                    root: [
                        './test/examples/components',
                        './test/examples/foo'
                    ]
                }]
            ]
        };

        const transformerOptsGlob = {
            plugins: [
                [plugin, {
                    root: ['./test/**/components']
                }]
            ]
        };

        describe('should resolve the file path', () => {
            testRequireImport(
                'c1',
                './test/examples/components/c1',
                transformerOpts
            );
        });

        describe('should resolve the sub file path', () => {
            testRequireImport(
                'sub/sub1',
                './test/examples/components/sub/sub1',
                transformerOpts
            );
        });

        describe('should resolve the file path while keeping the extension', () => {
            testRequireImport(
                'sub/sub1.css',
                './test/examples/components/sub/sub1.css',
                transformerOpts
            );
        });

        describe('should resolve the file path with a filename containing a dot', () => {
            testRequireImport(
                'sub/custom.modernizr3',
                './test/examples/components/sub/custom.modernizr3',
                transformerOpts
            );
        });

        describe('should resolve the file path according to a glob', () => {
            testRequireImport(
                'c1',
                './test/examples/components/c1',
                transformerOptsGlob
            );
        });

        describe('should resolve to a file instead of a directory', () => {
            // When a file and a directory on the same level share the same name,
            // the file has priority according to the Node require mechanism
            testRequireImport(
                'bar',
                '../bar',
                {
                    ...transformerOpts,
                    filename: './test/examples/foo/bar/x.js'
                }
            );
        });

        describe('should not resolve a path outisde of the root directory', () => {
            testRequireImport(
                'example-file',
                'example-file',
                transformerOpts
            );
        });

        describe('with proxyquire import', () => {
            it('should resolve stub paths', () => {
                const code = 'var something = proxyquire("c1", { "c2": stub });';
                const result = transform(code, transformerOpts);

                assert.strictEqual(result.code,
                    'var something = proxyquire("./test/examples/components/c1", {\n  "./c2": stub\n});');
            });
        });
    });

    describe('alias', () => {
        const transformerOpts = {
            plugins: [
                [plugin, {
                    alias: {
                        utils: './src/mylib/subfolder/utils',
                        'awesome/components': './src/components',
                        abstract: 'npm:concrete',
                        underscore: 'lodash'
                    }
                }]
            ]
        };

        describe('with a simple alias', () => {
            describe('should alias the file path', () => {
                testRequireImport(
                    'utils',
                    './src/mylib/subfolder/utils',
                    transformerOpts
                );
            });

            describe('should alias the sub file path', () => {
                testRequireImport(
                    'utils/my-util-file',
                    './src/mylib/subfolder/utils/my-util-file',
                    transformerOpts
                );
            });
        });

        describe('with an alias containing a slash', () => {
            describe('should alias the file path', () => {
                testRequireImport(
                    'awesome/components',
                    './src/components',
                    transformerOpts
                );
            });

            describe('should alias the sub file path', () => {
                testRequireImport(
                    'awesome/components/my-comp',
                    './src/components/my-comp',
                    transformerOpts
                );
            });
        });

        describe('should alias a path containing a dot in the filename', () => {
            testRequireImport(
                'utils/custom.modernizr3',
                './src/mylib/subfolder/utils/custom.modernizr3',
                transformerOpts
            );
        });

        describe('should alias the path with its extension', () => {
            testRequireImport(
                'awesome/components/my-comp.css',
                './src/components/my-comp.css',
                transformerOpts
            );
        });

        describe('should not alias a unknown path', () => {
            describe('when requiring a node module', () => {
                testRequireImport(
                    'other-lib',
                    'other-lib',
                    transformerOpts
                );
            });

            describe('when requiring a specific un-mapped file', () => {
                testRequireImport(
                    './l/otherLib',
                    './l/otherLib',
                    transformerOpts
                );
            });
        });

        describe('(legacy) should support aliasing a node module with "npm:"', () => {
            testRequireImport(
                'abstract/thing',
                'concrete/thing',
                transformerOpts
            );
        });

        describe('should support aliasing a node modules', () => {
            testRequireImport(
                'underscore/map',
                'lodash/map',
                transformerOpts
            );
        });
    });
});
