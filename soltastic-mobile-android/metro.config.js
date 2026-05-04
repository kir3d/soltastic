const { getDefaultConfig } = require('expo/metro-config');
const nodePath = require('path');

const config = getDefaultConfig(__dirname);

config.resolver.unstable_enablePackageExports = false;

const shim = (fileName) =>
  nodePath.resolve(__dirname, 'src', 'shims', fileName);

const previousResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'os') {
    return {
      type: 'sourceFile',
      filePath: shim('os.js'),
    };
  }

  if (moduleName === 'path') {
    return {
      type: 'sourceFile',
      filePath: shim('path.js'),
    };
  }

  if (moduleName === 'util') {
    return {
      type: 'sourceFile',
      filePath: shim('util.js'),
    };
  }

  if (
    moduleName === 'crc/calculators/crc16ccitt' ||
    moduleName === 'crc/calculators/crc16ccitt.js'
  ) {
    return {
      type: 'sourceFile',
      filePath: shim('crc16ccitt.js'),
    };
  }

  if (previousResolveRequest) {
    return previousResolveRequest(context, moduleName, platform);
  }

  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
