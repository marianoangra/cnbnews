"""Testes do validador do acervo de músicas da Rádio CNB."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import acervo as a  # noqa: E402


def faixa(**kw):
    f = {"arquivo": "x.mp3", "titulo": "Manhã", "autor": "Fulano", "licenca": "CC0",
         "fonte_url": "https://freemusicarchive.org/music/fulano/manha", "duracao": 180.0}
    f.update(kw)
    return f


class TestValidar(unittest.TestCase):
    def test_recusa_nc(self):
        self.assertTrue(a.validar([faixa(licenca="CC-BY-NC-4.0")], {"x.mp3"}))

    def test_recusa_nd(self):
        self.assertTrue(a.validar([faixa(licenca="CC-BY-ND-4.0")], {"x.mp3"}))

    def test_recusa_sem_fonte(self):
        self.assertTrue(a.validar([faixa(fonte_url="")], {"x.mp3"}))

    def test_recusa_sem_autor(self):
        self.assertTrue(a.validar([faixa(autor="")], {"x.mp3"}))

    def test_arquivo_sem_credito(self):
        self.assertTrue(a.validar([faixa()], {"x.mp3", "orfa.mp3"}))

    def test_credito_sem_arquivo(self):
        self.assertTrue(a.validar([faixa(arquivo="sumiu.mp3")], {"x.mp3"}))

    def test_aceita_lista_branca(self):
        for licenca in ["CC0", "PD", "CC-BY-3.0", "CC-BY-4.0", "CC-BY-SA-4.0"]:
            self.assertEqual(a.validar([faixa(licenca=licenca)], {"x.mp3"}), [], licenca)


class TestSite(unittest.TestCase):
    def test_gera_site_sem_arquivo_e_com_horas(self):
        site = a.gerar_site([faixa(duracao=1800.0), faixa(arquivo="y.mp3", duracao=1800.0)])
        self.assertEqual(site["horas"], 1.0)
        self.assertEqual(len(site["faixas"]), 2)
        self.assertNotIn("arquivo", site["faixas"][0])
        self.assertEqual(set(site["faixas"][0]), {"titulo", "autor", "licenca", "fonte_url"})


if __name__ == "__main__":
    unittest.main()
