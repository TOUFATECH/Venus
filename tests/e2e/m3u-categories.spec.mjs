// Liste M3U ajoutée : catégories prises dans le fichier (group-title)
import { test, expect } from '@playwright/test';
test('M3U ajoutée : catégorie d\'après le groupe du fichier', async () => {
  const { fileCat } = await import('../../server/channel-cats.js');
  expect(fileCat('Chaîne A', 'FOOT FR')).toBe('Sport');
  expect(fileCat('Chaîne B', 'Japan')).toBe('Japon');
  expect(fileCat('Chaîne C', 'KIDS')).toBe('Jeunesse');
  expect(fileCat('Info 24', 'FRANCE HD')).toBe('Info'); // groupe qui ne dit que le pays : d'après le nom
  expect(fileCat('Chaîne D', 'Ma liste perso')).toBe('Ma liste perso'); // groupe inconnu : gardé tel quel
  expect(fileCat('Xyz', '')).toBe('Autres');
});
