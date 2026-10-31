// SPDX-License-Identifier: GPL-3.0-or-later
import { Routes } from '@angular/router';

import { ContactDetailPage } from './contact-detail/contact-detail.page';
import { ContactEditPage } from './contact-edit/contact-edit.page';
import { ContactsPage } from './contacts.page';

export const contactsRoutes: Routes = [
  { path: '', component: ContactsPage },
  { path: 'new', component: ContactEditPage },
  { path: 'edit/:id', component: ContactEditPage },
  { path: ':id', component: ContactDetailPage },
];
