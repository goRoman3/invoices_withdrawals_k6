// multiuser/lib/users.example.js — шаблон пула юзеров для мульти-юзер стресс-тестов.
// VU берёт юзера как users[(__VU - 1) % users.length]; otpSecret — Base32.

export const users = [
  { username: '__SET_ME__', password: '__SET_ME__', otpSecret: '__SET_ME_BASE32__' },
  { username: '__SET_ME__', password: '__SET_ME__', otpSecret: '__SET_ME_BASE32__' },
];
