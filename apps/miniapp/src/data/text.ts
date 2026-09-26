// Мелкие помощники для русского текста интерфейса.

/** Форма слова по числу: plural(1, ['Заявка', 'Заявки', 'Заявок']) → «Заявка». */
export function plural(count: number, [one, few, many]: [string, string, string]): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** Приветствие по времени суток, с именем, если оно известно. */
export function greeting(now: Date, firstName?: string): string {
  const hour = now.getHours();
  const phrase =
    hour >= 5 && hour < 12
      ? 'Доброе утро'
      : hour >= 12 && hour < 18
        ? 'Добрый день'
        : hour >= 18 && hour < 23
          ? 'Добрый вечер'
          : 'Доброй ночи';
  return firstName ? `${phrase}, ${firstName}` : phrase;
}

/** «№ 2458» не рвётся между знаком и числом: пробел после № становится неразрывным. */
export function glueNumberSign(text: string): string {
  return text.replace(/№ (?=\d)/g, '№ ');
}

/** Диапазон «8:00–14:00» не рвётся после тире: за ним ставим невидимую связку. */
export function glueRanges(text: string): string {
  return text.replaceAll('–', '–⁠');
}
