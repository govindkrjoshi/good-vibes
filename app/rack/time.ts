// Whether a string is a time Tone.js can read. A bad time only throws when
// Tone fires it inside a transport callback, where nothing can catch it, so
// it has to be turned away up front.
//
// Accepted, each optionally after a `+` for "from now":
//   seconds            0.5   2   250ms   1.5s
//   a note length      4n   8t   1m   4n.   (dotted)
//   a frequency        2hz
//   bars:beats:sixteenths   1:2:0   0:0:3   2:1
//   ticks              96i
const forms = [
  /^\d+(?:\.\d+)?$/,
  /^\d+(?:\.\d+)?(?:s|ms)$/i,
  /^\d+(?:\.\d+)?hz$/i,
  /^\d+n\.?$/i,
  /^\d+t$/i,
  /^\d+m$/i,
  /^\d+i$/i,
  /^\d+(?:\.\d+)?:\d+(?:\.\d+)?(?::\d+(?:\.\d+)?)?$/,
];

export const isTime = (value: unknown): value is string | number => {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0;
  if (typeof value !== "string") return false;
  const held = value.trim().replace(/^\+\s*/, "");
  return held !== "" && forms.some((form) => form.test(held));
};

// A note length or a transport time, which is what a subdivision or an
// interval has to be: seconds work too, but a bare number reads as one.
export const timeHelp =
  "seconds (0.5), a note length (4n, 8t, 1m, 4n.), or bars:beats:sixteenths (1:2:0)";
