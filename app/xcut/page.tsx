// app/xcut/page.tsx — XCut, the cutting room. Signed-in only (the client
// shows the auth modal to strangers, like XDirect). ?p=<project> opens a
// cut; ?from=<board> makes the rough cut of an XDirect board and opens it.

import XCutClient from './client'

export default async function XCutPage() {
  return <XCutClient />
}
