"""Testes da lógica do boletim da Rádio CNB.  Rodar: python -m unittest discover -s services/radio"""
import datetime as dt
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import boletim as b  # noqa: E402

UTC = dt.timezone.utc
AGORA = dt.datetime(2026, 11, 28, 15, 0, tzinfo=UTC)


def seg(slug, horas_atras):
    return {"slug": slug, "titulo": slug, "ts": AGORA - dt.timedelta(hours=horas_atras)}


def brt(h, m=0):
    return dt.datetime(2026, 11, 28, h, m)


class TestEscolher(unittest.TestCase):
    def test_ignora_mais_de_24h(self):
        segs = [seg("a", 1), seg("b", 2), seg("c", 3), seg("velha", 25)]
        slugs = [s["slug"] for s in b.escolher(segs, AGORA, {}, 6)]
        self.assertNotIn("velha", slugs)
        self.assertEqual(len(slugs), 3)

    def test_nao_repete_no_bloco_seguinte(self):
        segs = [seg("a", 1), seg("b", 2), seg("c", 3), seg("d", 4)]
        tocados = {"a": (AGORA - dt.timedelta(minutes=55)).isoformat(),
                   "b": (AGORA - dt.timedelta(minutes=125)).isoformat()}
        slugs = [s["slug"] for s in b.escolher(segs, AGORA, tocados, 6)]
        self.assertNotIn("a", slugs)
        self.assertIn("b", slugs)

    def test_ordem_mais_recente_primeiro(self):
        segs = [seg("velho", 5), seg("novo", 1), seg("meio", 3)]
        self.assertEqual([s["slug"] for s in b.escolher(segs, AGORA, {}, 6)], ["novo", "meio", "velho"])

    def test_limita_a_n(self):
        segs = [seg(str(i), i) for i in range(10)]
        self.assertEqual(len(b.escolher(segs, AGORA, {}, b.TIPOS["manchetes"])), 4)

    def test_estoque_insuficiente_devolve_vazio(self):
        self.assertEqual(b.escolher([seg("so-um", 1)], AGORA, {}, b.TIPOS["completo"]), [])
        self.assertEqual(b.escolher([seg("so-um", 1)], AGORA, {}, b.TIPOS["manchetes"]), [])

    def test_manchetes_com_dois_basta(self):
        self.assertEqual(len(b.escolher([seg("a", 1), seg("b", 2)], AGORA, {}, b.TIPOS["manchetes"])), 2)

    def test_completo_exige_tres(self):
        self.assertEqual(b.escolher([seg("a", 1), seg("b", 2)], AGORA, {}, b.TIPOS["completo"]), [])


class TestHoraCerta(unittest.TestCase):
    def test_hora_certa(self):
        self.assertEqual(b.hora_certa(brt(14)), "São quatorze horas em Brasília.")
        self.assertEqual(b.hora_certa(brt(1)), "É uma hora em Brasília.")
        self.assertEqual(b.hora_certa(brt(0)), "É meia-noite em Brasília.")
        self.assertEqual(b.hora_certa(brt(12)), "É meio-dia em Brasília.")
        self.assertEqual(b.hora_certa(brt(2)), "São duas horas em Brasília.")
        self.assertEqual(b.hora_certa(brt(21)), "São vinte e uma horas em Brasília.")
        self.assertEqual(b.hora_certa(brt(22)), "São vinte e duas horas em Brasília.")

    def test_meia_hora(self):
        self.assertEqual(b.hora_certa(brt(14, 30)), "São quatorze horas e trinta minutos em Brasília.")
        self.assertEqual(b.hora_certa(brt(0, 30)), "É meia-noite e trinta minutos em Brasília.")


if __name__ == "__main__":
    unittest.main()
