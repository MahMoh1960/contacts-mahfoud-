/* Numéros d'urgence – Maroc.
   Vérifiés le 13/10/2026 d'après : Ambassade de France au Maroc (ma.diplomatie.gouv.fr/fr/urgence),
   Consulat général de France à Agadir (numéros utiles), Challenge.ma. */
const URGENCES_DATE = '13/10/2026';
const URGENCES = [
  { id: 'police', fr: 'Police secours', ar: 'الشرطة (النجدة)', numbers: ['19'] },
  { id: 'gend', fr: 'Gendarmerie Royale', ar: 'الدرك الملكي', numbers: ['177'] },
  { id: 'pc', fr: 'Protection civile', ar: 'الوقاية المدنية', note_fr: 'Pompiers et ambulance', note_ar: 'الإطفاء والإسعاف', numbers: ['15'] },
  { id: 'samu', fr: 'SAMU', ar: 'سامو', note_fr: 'Urgences médicales', note_ar: 'المستعجلات الطبية', numbers: ['141'] },
  { id: 'poison', fr: 'Centre antipoison et de pharmacovigilance', ar: 'مركز مكافحة السموم واليقظة الدوائية', note_fr: '24 h/24', note_ar: 'على مدار الساعة', numbers: ['0537686464', '0801000180'] }
];
