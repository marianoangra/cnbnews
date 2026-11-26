"""Testes das travas editoriais do robo_cnb.py.  Rodar: python -m unittest discover -s tests"""
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import robo_cnb as r  # noqa: E402


class TestSensibilidade(unittest.TestCase):
    def test_caso_real_lorena_vai_para_fila(self):
        score, motivos = r.avaliar_sensibilidade(
            "PM apreende adolescente com três armas em Lorena",
            "Polícia Militar apreendeu um adolescente que possuía três armas de fogo e drogas.",
            "A Polícia Militar apreendeu um adolescente na região de Lorena (SP) que estava em posse de três armas de fogo.",
        )
        self.assertGreaterEqual(score, r.LIMITE_SCORE_HUMANO)
        self.assertTrue(any("ECA" in m for m in motivos))

    def test_materias_comuns_passam(self):
        casos = [
            ("Resende realiza segunda edição da Mostra Musicando", "Alunos e professores apresentam trabalhos.",
             "A prefeitura de Resende promove a mostra com estudantes da rede municipal."),
            ("Pelotas abre pré-matrícula 2027 na rede pública", "Inscrições vão até dezembro.",
             "Crianças e adolescentes podem ser inscritos pelos responsáveis no site da prefeitura."),
            ("Festa do Pêssego é sucesso na colônia de Pelotas", "Evento reuniu produtores.",
             "A festa teve shows, gastronomia e venda direta de frutas."),
        ]
        for t, d, x in casos:
            score, motivos = r.avaliar_sensibilidade(t, d, x)
            self.assertLess(score, r.LIMITE_SCORE_HUMANO, f"{t} -> {motivos}")

    def test_termo_condenatorio_com_acento(self):
        score, _ = r.avaliar_sensibilidade("Ladrão é preso no centro", "", "")
        self.assertEqual(score, 5)

    def test_corrupcao_e_crime_violento(self):
        self.assertGreaterEqual(r.avaliar_sensibilidade("Operação apura desvio de recursos na saúde", "", "")[0], 4)
        self.assertEqual(r.avaliar_sensibilidade("Homicídio no bairro Fragata", "", "")[0], 5)

    def test_contraditorio(self):
        self.assertTrue(r.precisa_contraditorio("Empresário é investigado pela PF", "", ""))
        self.assertFalse(r.precisa_contraditorio("Feira do livro começa sábado", "", ""))


class TestDuplicadaOlhaFila(unittest.TestCase):
    def test_pauta_ja_na_fila_conta_como_duplicada(self):
        antigo = os.getcwd()
        with tempfile.TemporaryDirectory() as tmp:
            os.chdir(tmp)
            try:
                os.makedirs("content/cidades/lorena")
                os.makedirs(os.path.join(r.FILA_APROVACAO, "lorena"))
                with open(os.path.join(r.FILA_APROVACAO, "lorena",
                                       "2026-11-26-pm-apreende-adolescente-com-tres-armas-em-lorena.md"), "w") as f:
                    f.write("---\n---\n")
                self.assertTrue(r.eh_duplicada("content/cidades/lorena", "PM apreende adolescente com três armas em Lorena"))
                self.assertFalse(r.eh_duplicada("content/cidades/lorena", "Prefeitura de Lorena inaugura nova creche municipal"))
            finally:
                os.chdir(antigo)


if __name__ == "__main__":
    unittest.main()
