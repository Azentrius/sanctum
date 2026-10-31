// SPDX-License-Identifier: GPL-3.0-or-later
import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  ElementRef,
  Input,
  OnChanges,
  ViewChild,
} from '@angular/core';

import { renderSafeMarkdown } from '../../../core/markdown/safe-markdown.render';

@Component({
  selector: 'app-markdown-view',
  standalone: true,
  imports: [CommonModule],
  template: `<div #host class="markdown-body"></div>`,
  styleUrls: ['./markdown-view.component.scss'],
})
export class MarkdownViewComponent implements AfterViewInit, OnChanges {
  @Input() content = '';
  @ViewChild('host', { static: true }) host!: ElementRef<HTMLElement>;

  ngAfterViewInit(): void {
    this.render();
  }

  ngOnChanges(): void {
    this.render();
  }

  private render(): void {
    if (!this.host?.nativeElement) {
      return;
    }
    renderSafeMarkdown(this.host.nativeElement, this.content ?? '');
  }
}
