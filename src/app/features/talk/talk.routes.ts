// SPDX-License-Identifier: GPL-3.0-or-later
import { Routes } from '@angular/router';

import { CallPage } from './call/call.page';
import { ChatRoomPage } from './chat-room/chat-room.page';
import { TalkPage } from './talk.page';

export const talkRoutes: Routes = [
  { path: '', component: TalkPage },
  { path: 'room/:accountId/:token', component: ChatRoomPage },
  { path: 'call/:accountId/:token', component: CallPage },
];
