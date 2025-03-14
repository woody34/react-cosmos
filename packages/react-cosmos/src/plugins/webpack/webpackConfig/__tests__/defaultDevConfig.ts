// NOTE: Mock files need to imported before modules that use the mocked APIs
import { unmockCliArgs } from '../../../../testHelpers/mockYargs';
import { mockConsole } from '../../../../testHelpers/mockConsole';

import webpack from 'webpack';
import { createCosmosConfig } from '../../../../config/createCosmosConfig';
import { RENDERER_FILENAME } from '../../../../shared/playgroundHtml';
import { HtmlWebpackPlugin } from '../htmlPlugin';
import { getDevWebpackConfig } from '../getDevWebpackConfig';

afterAll(() => {
  unmockCliArgs();
});

async function getDefaultDevWebpackConfig() {
  return mockConsole(async ({ expectLog }) => {
    expectLog('[Cosmos] Using default webpack config');
    const cosmosConfig = createCosmosConfig(process.cwd());
    return await getDevWebpackConfig(cosmosConfig, webpack);
  });
}

it('includes client entry', async () => {
  const { entry } = await getDefaultDevWebpackConfig();
  expect(entry).toContain(require.resolve('../../client'));
});

it('includes DOM devtooks hook entry', async () => {
  const { entry } = await getDefaultDevWebpackConfig();
  expect(entry).toContain(require.resolve('../../client/reactDevtoolsHook'));
});

it('includes webpack-hot-middleware entry', async () => {
  const { entry } = await getDefaultDevWebpackConfig();
  expect(entry).toContain(
    `${require.resolve(
      '@skidding/webpack-hot-middleware/client'
    )}?reload=true&overlay=false`
  );
});

it('create output', async () => {
  const { output } = await getDefaultDevWebpackConfig();
  expect(output).toEqual(
    expect.objectContaining({
      filename: '[name].js',
      publicPath: '/',
    })
  );
});

it('includes user deps loader', async () => {
  const { module } = await getDefaultDevWebpackConfig();
  expect(module!.rules).toContainEqual({
    loader: require.resolve('../userDepsLoader'),
    include: require.resolve('../../client/userDeps'),
  });
});

it('includes HtmlWebpackPlugin', async () => {
  const { plugins } = await getDefaultDevWebpackConfig();
  const htmlWebpackPlugin = plugins!.find(
    p => p.constructor.name === 'HtmlWebpackPlugin'
  ) as HtmlWebpackPlugin;
  expect(htmlWebpackPlugin).toBeDefined();
  expect(htmlWebpackPlugin.userOptions).toEqual(
    expect.objectContaining({ filename: RENDERER_FILENAME })
  );
});

it('includes HotModuleReplacementPlugin', async () => {
  const { plugins } = await getDefaultDevWebpackConfig();
  const hotModuleReplacementPlugin = plugins!.find(
    p => p.constructor.name === 'HotModuleReplacementPlugin'
  );
  expect(hotModuleReplacementPlugin).toBeDefined();
});
