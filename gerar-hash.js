import bcrypt from 'bcryptjs'

const senha = 'parecerista@vinicius'

bcrypt.hash(senha, 10).then(hash => {
  console.log(hash)
})