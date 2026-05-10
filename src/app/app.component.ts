import { Component } from '@angular/core';

import { PuzzleComponent } from './puzzle/puzzle.component';

@Component({
  selector: 'app-root',
  imports: [PuzzleComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {}
