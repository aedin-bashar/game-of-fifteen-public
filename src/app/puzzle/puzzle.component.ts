import { CommonModule } from '@angular/common';
import { Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild, computed, signal } from '@angular/core';

type BoardSize = 3 | 4 | 5;
type Difficulty = 'easy' | 'medium' | 'hard' | 'expert';
type TileValue = number | null;
type PendingRestartAction =
  | { type: 'new-game' }
  | { type: 'daily' }
  | { type: 'board-size'; size: BoardSize }
  | { type: 'difficulty'; difficulty: Difficulty };

interface TileView {
  value: number;
  row: number;
  col: number;
  solved: boolean;
  movable: boolean;
  invalid: boolean;
  justCorrect: boolean;
}

interface DifficultyOption {
  label: string;
  value: Difficulty;
}

@Component({
  selector: 'app-puzzle',
  imports: [CommonModule],
  templateUrl: './puzzle.component.html',
  styleUrl: './puzzle.component.scss',
})
export class PuzzleComponent implements OnInit, OnDestroy {
  @ViewChild('playAgainButton') private playAgainButton?: ElementRef<HTMLButtonElement>;
  @ViewChild('confirmRestartButton') private confirmRestartButton?: ElementRef<HTMLButtonElement>;

  private readonly bestMovesPrefix = 'game-of-fifteen-best-moves';
  private readonly bestTimePrefix = 'game-of-fifteen-best-time';
  private readonly difficultySteps: Record<Difficulty, number> = {
    easy: 18,
    medium: 48,
    hard: 110,
    expert: 220,
  };
  private timerId: ReturnType<typeof setInterval> | null = null;
  private invalidFeedbackId: ReturnType<typeof setTimeout> | null = null;
  private boardInvalidFeedbackId: ReturnType<typeof setTimeout> | null = null;
  private correctFeedbackId: ReturnType<typeof setTimeout> | null = null;

  protected readonly boardSizes: BoardSize[] = [3, 4, 5];
  protected readonly difficultyOptions: DifficultyOption[] = [
    { label: 'Easy', value: 'easy' },
    { label: 'Medium', value: 'medium' },
    { label: 'Hard', value: 'hard' },
    { label: 'Expert', value: 'expert' },
  ];

  protected readonly boardSize = signal<BoardSize>(4);
  protected readonly difficulty = signal<Difficulty>('hard');
  protected readonly board = signal<TileValue[]>([]);
  protected readonly moves = signal(0);
  protected readonly elapsedSeconds = signal(0);
  protected readonly hasStarted = signal(false);
  protected readonly isSolved = signal(false);
  protected readonly showVictory = signal(false);
  protected readonly bestMoves = signal<number | null>(null);
  protected readonly bestTime = signal<number | null>(null);
  protected readonly newBestMoves = signal(false);
  protected readonly newBestTime = signal(false);
  protected readonly invalidTile = signal<number | null>(null);
  protected readonly boardInvalid = signal(false);
  protected readonly justCorrectTile = signal<number | null>(null);
  protected readonly isDailyPuzzle = signal(false);
  protected readonly showRestartWarning = signal(false);

  protected readonly totalTiles = computed(() => this.boardSize() * this.boardSize());
  protected readonly targetTileCount = computed(() => this.totalTiles() - 1);
  protected readonly emptyIndex = computed(() => this.board().findIndex((value) => value === null));
  protected readonly emptyRow = computed(() => Math.floor(this.emptyIndex() / this.boardSize()));
  protected readonly emptyCol = computed(() => this.emptyIndex() % this.boardSize());
  protected readonly correctCount = computed(
    () => this.board().filter((value, index) => value !== null && value === index + 1).length,
  );
  protected readonly progressPercent = computed(() =>
    Math.round((this.correctCount() / this.targetTileCount()) * 100),
  );
  protected readonly tiles = computed<TileView[]>(() =>
    this.board()
      .map((value, index) => {
        if (value === null) {
          return null;
        }

        return {
          value,
          row: Math.floor(index / this.boardSize()),
          col: index % this.boardSize(),
          solved: value === index + 1,
          movable: this.isAdjacent(index, this.emptyIndex()),
          invalid: this.invalidTile() === value,
          justCorrect: this.justCorrectTile() === value,
        };
      })
      .filter((tile): tile is TileView => tile !== null),
  );

  ngOnInit(): void {
    this.loadBestScores();
    this.newGame();
  }

  ngOnDestroy(): void {
    this.stopTimer();
    this.clearFeedbackTimers();
  }

  protected newGame(): void {
    this.requestRestart({ type: 'new-game' });
  }

  protected startDailyPuzzle(): void {
    this.requestRestart({ type: 'daily' });
  }

  protected selectBoardSize(size: BoardSize): void {
    if (size === this.boardSize()) {
      return;
    }

    this.requestRestart({ type: 'board-size', size });
  }

  protected selectDifficulty(difficulty: Difficulty): void {
    if (difficulty === this.difficulty()) {
      return;
    }

    this.requestRestart({ type: 'difficulty', difficulty });
  }

  protected moveTileByValue(value: number): void {
    const tileIndex = this.board().indexOf(value);
    this.moveTile(tileIndex, value);
  }

  protected closeVictory(): void {
    this.showVictory.set(false);
  }

  protected cancelRestart(): void {
    this.pendingRestartAction = null;
    this.showRestartWarning.set(false);
  }

  protected confirmRestart(): void {
    const action = this.pendingRestartAction;

    if (!action) {
      this.cancelRestart();
      return;
    }

    this.pendingRestartAction = null;
    this.showRestartWarning.set(false);
    this.applyRestartAction(action);
  }

  protected async shareResult(): Promise<void> {
    const message = `I solved Game of Fifteen (${this.boardSize()}×${this.boardSize()}, ${this.difficultyLabel()}) in ${this.moves()} moves and ${this.formatTime(this.elapsedSeconds())}.`;

    if (navigator.share) {
      await navigator.share({ title: 'Game of Fifteen', text: message });
      return;
    }

    await navigator.clipboard?.writeText(message);
  }

  protected formatTime(totalSeconds: number | null): string {
    if (totalSeconds === null) {
      return '--:--';
    }

    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }

  protected difficultyLabel(): string {
    return this.difficultyOptions.find((option) => option.value === this.difficulty())?.label ?? 'Hard';
  }

  protected trackTile(_index: number, tile: TileView): number {
    return tile.value;
  }

  protected tileAriaLabel(tile: TileView): string {
    const state = tile.solved ? 'in the correct position' : 'not in the correct position';
    const action = tile.movable ? 'can slide into the empty space' : 'cannot move right now';

    return `Tile ${tile.value}, row ${tile.row + 1}, column ${tile.col + 1}, ${state}, ${action}`;
  }

  @HostListener('window:keydown', ['$event'])
  protected handleKeydown(event: KeyboardEvent): void {
    if (this.showRestartWarning()) {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.cancelRestart();
      }

      return;
    }

    if (this.showVictory()) {
      if (event.key === 'Escape') {
        this.closeVictory();
      }

      return;
    }

    const target = event.target instanceof HTMLElement ? event.target : null;
    const isBoardTarget = target === document.body || target?.closest('.puzzle-board');

    if (!isBoardTarget) {
      return;
    }

    const size = this.boardSize();
    const arrowMoves: Record<string, number> = {
      ArrowUp: this.emptyIndex() + size,
      ArrowDown: this.emptyIndex() - size,
      ArrowLeft: this.emptyIndex() + 1,
      ArrowRight: this.emptyIndex() - 1,
    };

    if (!(event.key in arrowMoves) || this.isSolved()) {
      return;
    }

    event.preventDefault();
    this.moveTile(arrowMoves[event.key]);
  }

  private resetRound(): void {
    this.stopTimer();
    this.clearFeedbackTimers();
    this.moves.set(0);
    this.elapsedSeconds.set(0);
    this.hasStarted.set(false);
    this.isSolved.set(false);
    this.showVictory.set(false);
    this.newBestMoves.set(false);
    this.newBestTime.set(false);
    this.invalidTile.set(null);
    this.boardInvalid.set(false);
    this.justCorrectTile.set(null);
  }

  private pendingRestartAction: PendingRestartAction | null = null;

  private requestRestart(action: PendingRestartAction): void {
    if (this.shouldWarnBeforeRestart()) {
      this.pendingRestartAction = action;
      this.showRestartWarning.set(true);
      setTimeout(() => this.confirmRestartButton?.nativeElement.focus(), 0);
      return;
    }

    this.applyRestartAction(action);
  }

  private shouldWarnBeforeRestart(): boolean {
    return this.hasStarted() && !this.isSolved();
  }

  private applyRestartAction(action: PendingRestartAction): void {
    if (action.type === 'board-size') {
      this.boardSize.set(action.size);
      this.loadBestScores();
      this.startRegularGame();
      return;
    }

    if (action.type === 'difficulty') {
      this.difficulty.set(action.difficulty);
      this.loadBestScores();
      this.startRegularGame();
      return;
    }

    if (action.type === 'daily') {
      this.startDailyGame();
      return;
    }

    this.startRegularGame();
  }

  private startRegularGame(): void {
    this.resetRound();
    this.isDailyPuzzle.set(false);
    this.board.set(this.createSolvableBoard());
  }

  private startDailyGame(): void {
    this.resetRound();
    this.isDailyPuzzle.set(true);
    this.board.set(this.createSolvableBoard(this.dailySeed()));
  }

  private moveTile(tileIndex: number, value?: number): void {
    const emptyIndex = this.emptyIndex();

    if (!this.isAdjacent(tileIndex, emptyIndex) || this.isSolved()) {
      if (value !== undefined && !this.isSolved()) {
        this.showInvalidFeedback(value);
      } else if (!this.isSolved()) {
        this.showBoardInvalidFeedback();
      }

      return;
    }

    if (!this.hasStarted()) {
      this.hasStarted.set(true);
      this.startTimer();
    }

    const nextBoard = [...this.board()];
    const movedValue = nextBoard[tileIndex];
    [nextBoard[tileIndex], nextBoard[emptyIndex]] = [nextBoard[emptyIndex], nextBoard[tileIndex]];

    this.board.set(nextBoard);
    this.moves.update((moves) => moves + 1);
    this.showCorrectFeedback(movedValue, emptyIndex);

    if (this.isBoardSolved(nextBoard)) {
      this.finishGame();
    }
  }

  private createSolvableBoard(seed?: number): TileValue[] {
    let shuffled: TileValue[];
    const random = seed === undefined ? Math.random : this.seededRandom(seed);

    do {
      shuffled = this.shuffleByLegalMoves(random);
    } while (!this.isSolvable(shuffled) || this.isBoardSolved(shuffled));

    return shuffled;
  }

  private shuffleByLegalMoves(random: () => number): TileValue[] {
    const size = this.boardSize();
    const board = this.solvedBoard();
    const totalSteps = this.difficultySteps[this.difficulty()] + size * size * 3;
    let emptyIndex = board.indexOf(null);
    let previousEmptyIndex = -1;

    for (let step = 0; step < totalSteps; step += 1) {
      let candidates = this.adjacentIndexes(emptyIndex).filter((index) => index !== previousEmptyIndex);

      if (candidates.length === 0) {
        candidates = this.adjacentIndexes(emptyIndex);
      }

      const tileIndex = candidates[Math.floor(random() * candidates.length)];
      [board[tileIndex], board[emptyIndex]] = [board[emptyIndex], board[tileIndex]];
      previousEmptyIndex = emptyIndex;
      emptyIndex = tileIndex;
    }

    return board;
  }

  private solvedBoard(): TileValue[] {
    return [...Array.from({ length: this.totalTiles() - 1 }, (_, index) => index + 1), null];
  }

  private isSolvable(board: TileValue[]): boolean {
    const values = board.filter((value): value is number => value !== null);
    let inversions = 0;

    for (let outer = 0; outer < values.length - 1; outer += 1) {
      for (let inner = outer + 1; inner < values.length; inner += 1) {
        if (values[outer] > values[inner]) {
          inversions += 1;
        }
      }
    }

    if (this.boardSize() % 2 === 1) {
      return inversions % 2 === 0;
    }

    const emptyRowFromBottom = this.boardSize() - Math.floor(board.indexOf(null) / this.boardSize());

    return (inversions + emptyRowFromBottom) % 2 === 1;
  }

  private isBoardSolved(board: TileValue[]): boolean {
    return board.every((value, index) => (index === this.totalTiles() - 1 ? value === null : value === index + 1));
  }

  private isAdjacent(tileIndex: number, emptyIndex: number): boolean {
    if (tileIndex < 0 || emptyIndex < 0) {
      return false;
    }

    return this.adjacentIndexes(emptyIndex).includes(tileIndex);
  }

  private adjacentIndexes(index: number): number[] {
    const size = this.boardSize();
    const row = Math.floor(index / size);
    const col = index % size;
    const candidates = [
      row > 0 ? index - size : -1,
      row < size - 1 ? index + size : -1,
      col > 0 ? index - 1 : -1,
      col < size - 1 ? index + 1 : -1,
    ];

    return candidates.filter((candidate) => candidate >= 0);
  }

  private showInvalidFeedback(value: number): void {
    if (this.invalidFeedbackId) {
      clearTimeout(this.invalidFeedbackId);
    }

    this.invalidTile.set(value);
    this.invalidFeedbackId = setTimeout(() => this.invalidTile.set(null), 360);
  }

  private showBoardInvalidFeedback(): void {
    if (this.boardInvalidFeedbackId) {
      clearTimeout(this.boardInvalidFeedbackId);
    }

    this.boardInvalid.set(true);
    this.boardInvalidFeedbackId = setTimeout(() => this.boardInvalid.set(false), 320);
  }

  private showCorrectFeedback(value: TileValue, landedIndex: number): void {
    if (value === null || value !== landedIndex + 1) {
      return;
    }

    if (this.correctFeedbackId) {
      clearTimeout(this.correctFeedbackId);
    }

    this.justCorrectTile.set(value);
    this.correctFeedbackId = setTimeout(() => this.justCorrectTile.set(null), 520);
  }

  private startTimer(): void {
    this.timerId = setInterval(() => {
      this.elapsedSeconds.update((seconds) => seconds + 1);
    }, 1000);
  }

  private stopTimer(): void {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  private finishGame(): void {
    this.stopTimer();
    this.isSolved.set(true);
    this.saveBestScores();
    this.showVictory.set(true);
    setTimeout(() => this.playAgainButton?.nativeElement.focus(), 0);
  }

  private loadBestScores(): void {
    this.bestMoves.set(this.readStoredNumber(this.bestKey(this.bestMovesPrefix)));
    this.bestTime.set(this.readStoredNumber(this.bestKey(this.bestTimePrefix)));
  }

  private saveBestScores(): void {
    const currentMoves = this.moves();
    const currentTime = this.elapsedSeconds();

    if (this.bestMoves() === null || currentMoves < this.bestMoves()!) {
      this.newBestMoves.set(true);
      this.bestMoves.set(currentMoves);
      localStorage.setItem(this.bestKey(this.bestMovesPrefix), currentMoves.toString());
    }

    if (this.bestTime() === null || currentTime < this.bestTime()!) {
      this.newBestTime.set(true);
      this.bestTime.set(currentTime);
      localStorage.setItem(this.bestKey(this.bestTimePrefix), currentTime.toString());
    }
  }

  private readStoredNumber(key: string): number | null {
    const stored = localStorage.getItem(key);
    const parsed = stored === null ? Number.NaN : Number(stored);

    return Number.isFinite(parsed) ? parsed : null;
  }

  private bestKey(prefix: string): string {
    return `${prefix}-${this.boardSize()}x${this.boardSize()}-${this.difficulty()}`;
  }

  private dailySeed(): number {
    const today = new Date();
    const dateKey =
      today.getFullYear() * 10000 +
      (today.getMonth() + 1) * 100 +
      today.getDate();

    return dateKey + this.boardSize() * 101 + this.difficultySteps[this.difficulty()];
  }

  private seededRandom(seed: number): () => number {
    let state = seed >>> 0;

    return () => {
      state = (state * 1664525 + 1013904223) >>> 0;

      return state / 4294967296;
    };
  }

  private clearFeedbackTimers(): void {
    if (this.invalidFeedbackId) {
      clearTimeout(this.invalidFeedbackId);
      this.invalidFeedbackId = null;
    }

    if (this.boardInvalidFeedbackId) {
      clearTimeout(this.boardInvalidFeedbackId);
      this.boardInvalidFeedbackId = null;
    }

    if (this.correctFeedbackId) {
      clearTimeout(this.correctFeedbackId);
      this.correctFeedbackId = null;
    }
  }
}
