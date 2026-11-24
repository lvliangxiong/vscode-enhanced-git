export function createCommitDateFormatter(now = new Date()) {
  const dayKey = (date) => `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
  const today = dayKey(now),
    previousDay = new Date(now);
  previousDay.setDate(previousDay.getDate() - 1);
  const yesterday = dayKey(previousDay);
  return (value) => {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    const day = dayKey(date),
      time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    return day === today
      ? `Today ${time}`
      : day === yesterday
        ? `Yesterday ${time}`
        : `${day}, ${time}`;
  };
}
