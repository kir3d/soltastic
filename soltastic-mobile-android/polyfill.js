import 'react-native-get-random-values';
import { Buffer } from 'buffer';
import { install } from 'react-native-quick-crypto';

import {
  ReadableStream,
  WritableStream,
  TransformStream,
} from 'web-streams-polyfill';

install();

const __soltasticGlobal = globalThis;

__soltasticGlobal.Buffer = __soltasticGlobal.Buffer || Buffer;

__soltasticGlobal.ReadableStream =
  __soltasticGlobal.ReadableStream || ReadableStream;

__soltasticGlobal.WritableStream =
  __soltasticGlobal.WritableStream || WritableStream;

__soltasticGlobal.TransformStream =
  __soltasticGlobal.TransformStream || TransformStream;

__soltasticGlobal.process = __soltasticGlobal.process || {};
__soltasticGlobal.process.env = __soltasticGlobal.process.env || {};
__soltasticGlobal.process.cwd =
  __soltasticGlobal.process.cwd || (() => '/');
