import {createHash,createPublicKey} from 'node:crypto';
import {readFileSync,statSync} from 'node:fs';

const manifestFile=new URL('../browser-extension/manifest.json',import.meta.url);

// Chrome derives unpacked extension IDs from the manifest's public SPKI key.
// This is an identity allowlist, not a secret; never trust a caller-supplied ID.
export function extensionOriginFromManifest(manifest){
 try{
  const key=manifest?.key;
  if(manifest?.manifest_version!==3||typeof key!=='string'||key.length>16384||!key.length||!/^[A-Za-z0-9+/]+={0,2}$/.test(key))return null;
  const der=Buffer.from(key,'base64');
  if(der.toString('base64')!==key)return null;
  const publicKey=createPublicKey({key:der,format:'der',type:'spki'});
  if(!publicKey.export({format:'der',type:'spki'}).equals(der))return null;
  const id=createHash('sha256').update(der).digest('hex').slice(0,32).replace(/[0-9a-f]/g,value=>String.fromCharCode(97+parseInt(value,16)));
  return `chrome-extension://${id}`;
 }catch{return null;}
}

export function readExtensionOrigin(path=manifestFile){
 try{
  if(statSync(path).size>65536)return null;
  return extensionOriginFromManifest(JSON.parse(readFileSync(path,'utf8')));
 }catch{return null;}
}

// Read once at startup from this installation, never from requests or settings.
export const trustedExtensionOrigin=readExtensionOrigin();
