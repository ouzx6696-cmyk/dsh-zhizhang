import { cp } from 'node:fs/promises';
await cp('packages/zhizhang/dist', 'build/zhizhang/dist', {recursive:true});
await cp('packages/dsh-adapter/dist', 'build/dsh-adapter/dist', {recursive:true});
