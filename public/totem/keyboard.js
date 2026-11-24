/* Teclado virtual para totens touch: não depende do teclado do sistema operacional. */
const ALPHA = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'ç'],
  ['{shift}', 'z', 'x', 'c', 'v', 'b', 'n', 'm', '{bksp}'],
  ['{acc}', '{space}', '{next}'],
];
const ACCENTS = [
  ['á', 'à', 'â', 'ã', 'é', 'ê', 'í', 'ó', 'ô', 'õ'],
  ['ú', 'ü', 'ç', '.', '-', "'", '&', '/', '(', ')'],
  ['{shift}', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '{bksp}'],
  ['{abc}', '{space}', '{next}'],
];
const EMAIL = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', '_'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm', '.', '-', '{bksp}'],
  ['@', '.com', '.com.br', '@gmail.com', '@hotmail.com', '@outlook.com', '{next}'],
];
const NUM = [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9'], ['{bksp}', '0', '{next}']];

export function createKeyboard(container, { onNext }) {
  let input = null, kind = 'name', shift = false, acc = false, last = false;

  const layout = () => (kind === 'phone' ? NUM : kind === 'email' ? EMAIL : acc ? ACCENTS : ALPHA);
  const autoCap = () => {
    if (!input || kind === 'email' || kind === 'phone') return false;
    const pos = input.selectionStart ?? input.value.length;
    return pos === 0 || /\s$/.test(input.value.slice(0, pos));
  };

  function label(k) {
    const upper = shift || autoCap();
    switch (k) {
      case '{shift}': return '⇧';
      case '{bksp}': return '⌫';
      case '{space}': return 'espaço';
      case '{next}': return last ? 'Concluir' : 'Próximo';
      case '{acc}': return 'Á É 123';
      case '{abc}': return 'ABC';
      default: return upper && k.length === 1 ? k.toLocaleUpperCase('pt-BR') : k;
    }
  }

  function draw() {
    container.className = `kb${kind === 'phone' ? ' kb-num' : ''}`;
    container.innerHTML = '';
    for (const row of layout()) {
      const r = document.createElement('div');
      r.className = 'kb-row';
      for (const k of row) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'kb-key';
        if (k === '{space}') b.classList.add('space');
        else if (k === '{next}') b.classList.add('go');
        else if (['{shift}', '{bksp}', '{acc}', '{abc}'].includes(k)) b.classList.add('dark', 'wide');
        else if (k.length > 2) b.classList.add('chunk');
        if (k === '{shift}' && shift) b.classList.add('on');
        b.dataset.k = k;
        b.textContent = label(k);
        b.setAttribute('aria-label', k === '{bksp}' ? 'Apagar' : k === '{shift}' ? 'Maiúsculas' : label(k));
        r.append(b);
      }
      container.append(r);
    }
  }

  function insert(text) {
    if (!input) return;
    const s = input.selectionStart ?? input.value.length, e = input.selectionEnd ?? s;
    if (input.maxLength > 0 && input.value.length - (e - s) + text.length > input.maxLength) return;
    input.setRangeText(text, s, e, 'end');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function backspace() {
    if (!input) return;
    const s = input.selectionStart ?? input.value.length, e = input.selectionEnd ?? s;
    if (s !== e) input.setRangeText('', s, e, 'end');
    else if (s > 0) input.setRangeText('', s - 1, s, 'end');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function press(k) {
    if (navigator.vibrate) navigator.vibrate(8);
    switch (k) {
      case '{shift}': shift = !shift; break;
      case '{bksp}': backspace(); break;
      case '{space}': if (input && input.value && !/\s$/.test(input.value.slice(0, input.selectionStart))) insert(' '); break;
      case '{next}': onNext(input); return;
      case '{acc}': acc = true; break;
      case '{abc}': acc = false; break;
      default: {
        let t = k;
        if (k.startsWith('@') && k.length > 1 && input && input.value.includes('@')) t = k.slice(1);
        if (k.length === 1 && (shift || autoCap())) t = k.toLocaleUpperCase('pt-BR');
        insert(t);
        shift = false;
      }
    }
    draw();
  }

  // pointerdown + preventDefault: o campo nunca perde o foco nem o cursor.
  let repeat = null;
  container.addEventListener('pointerdown', (ev) => {
    const b = ev.target.closest('.kb-key');
    if (!b) return;
    ev.preventDefault();
    b.classList.add('down');
    const k = b.dataset.k;
    press(k);
    if (k === '{bksp}') {
      clearTimeout(repeat);
      repeat = setTimeout(function rep() { backspace(); repeat = setTimeout(rep, 70); }, 450);
    }
  });
  const stop = () => { clearTimeout(repeat); repeat = null; container.querySelectorAll('.down').forEach((x) => x.classList.remove('down')); };
  container.addEventListener('pointerup', stop);
  container.addEventListener('pointercancel', stop);
  container.addEventListener('pointerleave', stop);
  container.addEventListener('contextmenu', (e) => e.preventDefault());

  return {
    show(el, k, isLast) { input = el; kind = k; last = !!isLast; acc = false; shift = false; container.hidden = false; draw(); },
    hide() { container.hidden = true; input = null; stop(); },
    refresh: draw,
  };
}
