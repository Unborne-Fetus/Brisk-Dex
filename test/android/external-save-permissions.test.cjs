'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const picker=fs.readFileSync(path.join(root,'android/app/src/main/java/com/briskemerald/briskdex/SaveFilePickerPlugin.java'),'utf8');
test('Android external saves require a persisted document grant',()=>{
 assert.match(picker,/ACTION_OPEN_DOCUMENT/);
 assert.match(picker,/getPersistedUriPermissions\(\)/);
 assert.match(picker,/requireDocumentGrant\(uri, false\)/);
 assert.match(picker,/requireDocumentGrant\(uri, true\)/);
});
test('Expired document URI guides reselection instead of implying game save corruption',()=>{
 assert.match(html,/Choose Browse device files to select it again/);
 assert.match(html,/Integrated game saves are unaffected/);
});
