import { PrismaClient } from '@prisma/client';
import process from 'node:process';

const prisma = new PrismaClient();

const questions = [
  {
    prompt: 'What is the capital city of Nigeria?',
    optionA: 'Lagos',
    optionB: 'Abuja',
    optionC: 'Kano',
    optionD: 'Port Harcourt',
    correctOption: 'B',
    category: 'Geography',
    difficulty: 'Easy',
  },
  {
    prompt: 'Who wrote "Things Fall Apart"?',
    optionA: 'Wole Soyinka',
    optionB: 'Chimamanda Adichie',
    optionC: 'Chinua Achebe',
    optionD: 'Ben Okri',
    correctOption: 'C',
    category: 'Literature',
    difficulty: 'Easy',
  },
  {
    prompt: 'What year did Nigeria gain independence?',
    optionA: '1957',
    optionB: '1960',
    optionC: '1963',
    optionD: '1965',
    correctOption: 'B',
    category: 'History',
    difficulty: 'Medium',
  },
  {
    prompt: 'What is the chemical symbol for Gold?',
    optionA: 'Go',
    optionB: 'Gd',
    optionC: 'Gl',
    optionD: 'Au',
    correctOption: 'D',
    category: 'Science',
    difficulty: 'Medium',
  },
  {
    prompt: 'What planet is closest to the sun?',
    optionA: 'Venus',
    optionB: 'Earth',
    optionC: 'Mercury',
    optionD: 'Mars',
    correctOption: 'C',
    category: 'Science',
    difficulty: 'Easy',
  },
  {
    prompt: 'What is 15% of 200?',
    optionA: '25',
    optionB: '30',
    optionC: '35',
    optionD: '40',
    correctOption: 'B',
    category: 'Math',
    difficulty: 'Easy',
  },
  {
    prompt: 'Which country won the 2022 FIFA World Cup?',
    optionA: 'Brazil',
    optionB: 'France',
    optionC: 'Argentina',
    optionD: 'Germany',
    correctOption: 'C',
    category: 'Sports',
    difficulty: 'Medium',
  },
  {
    prompt: 'What does HTTP stand for?',
    optionA: 'HyperText Transfer Protocol',
    optionB: 'High Transfer Text Program',
    optionC: 'HyperText Transmission Process',
    optionD: 'Hybrid Transfer Text Protocol',
    correctOption: 'A',
    category: 'Technology',
    difficulty: 'Hard',
  },
  {
    prompt: 'Who painted the Mona Lisa?',
    optionA: 'Michelangelo',
    optionB: 'Raphael',
    optionC: 'Donatello',
    optionD: 'Leonardo da Vinci',
    correctOption: 'D',
    category: 'Art',
    difficulty: 'Easy',
  },
  {
    prompt: 'What is the longest river in Africa?',
    optionA: 'Congo',
    optionB: 'Niger',
    optionC: 'Zambezi',
    optionD: 'Nile',
    correctOption: 'D',
    category: 'Geography',
    difficulty: 'Medium',
  },
  {
    prompt: 'How many planets are in our solar system?',
    optionA: '7',
    optionB: '8',
    optionC: '9',
    optionD: '10',
    correctOption: 'B',
    category: 'Science',
    difficulty: 'Easy',
  },
  {
    prompt: 'What is the square root of 144?',
    optionA: '11',
    optionB: '12',
    optionC: '13',
    optionD: '14',
    correctOption: 'B',
    category: 'Math',
    difficulty: 'Easy',
  },
];

async function main() {
  console.log('Seeding database...');

  for (const q of questions) {
    await prisma.question.upsert({
      where: {
        // Use prompt as a natural unique key for idempotent seeding
        id: (
          await prisma.question
            .findFirst({ where: { prompt: q.prompt } })
            .catch(() => null)
        )?.id ?? 'new',
      },
      update: {},
      create: q,
    });
  }

  // Simpler approach — just create if not exists by prompt
  console.log('Seed complete. Checking questions count...');
  const count = await prisma.question.count();
  console.log(`Total questions in database: ${count}`);
}

main()
  .catch(e => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
