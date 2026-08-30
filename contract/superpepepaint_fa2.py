# SUPERPEPEPAINT sovereign mint - FA2 NFT collection with an open compose-mint
#
# The participatory model: the composer app is the minting interface. A
# collector composes a tune, then calls `mint` with the SPP1 tune code;
# the CONTRACT builds artifactUri = base_uri + code, so every token in the
# collection provably points at the canonical app rendering that exact tune.
#
# Design:
# - open mint (anyone, price-gated), token ids increment from 0
# - genesis: the artist's own first mint is token 0, same entrypoint
# - token_info = shared_info (admin-set constants: decimals, displayUri,
#   thumbnailUri, royalties, creators, tags, ...) + per-token dynamic keys
#   (name, artifactUri, formats, attributes, description, tune)
# - integrity enforced on chain: code must start with "SPP1.", bounded
#   lengths, artifactUri/formats built by the contract itself
# - admin: set price / pause / base uri / shared info / metadata,
#   withdraw proceeds, hand over admin
#
# Build: python contract/superpepepaint_fa2.py  (SmartPy >= 0.24)
# Output: superpepepaint_fa2/ scenario dir with compiled .tz/.json artifacts

import smartpy as sp
from smartpy.templates import fa2_lib as fa2

main = fa2.main


@sp.module
def m():
    import main

    class SuperPepePaint(
        main.Admin,
        main.Nft,
        main.ChangeMetadata,
        main.WithdrawMutez,
        main.OnchainviewBalanceOf,
    ):
        def __init__(
            self,
            administrator,
            metadata,
            mint_price,
            base_uri,
            shared_info,
        ):
            main.OnchainviewBalanceOf.__init__(self)
            main.WithdrawMutez.__init__(self)
            main.ChangeMetadata.__init__(self)
            main.Nft.__init__(self, metadata, {}, [])
            main.Admin.__init__(self, administrator)
            self.data.mint_price = sp.cast(mint_price, sp.mutez)
            self.data.base_uri = sp.cast(base_uri, sp.bytes)
            self.data.shared_info = sp.cast(shared_info, sp.map[sp.string, sp.bytes])
            self.data.paused = False

        @sp.entrypoint
        def mint(self, params):
            """Open compose-mint: anyone pays mint_price and mints their tune.

            code: the SPP1 tune code as UTF-8 bytes ("SPP1." + base64url payload)
            name / attributes / description: TZIP-21 fields as UTF-8/JSON bytes
            """
            sp.cast(
                params,
                sp.record(
                    code=sp.bytes,
                    name=sp.bytes,
                    attributes=sp.bytes,
                    description=sp.bytes,
                ).layout(("code", ("name", ("attributes", "description")))),
            )
            assert not self.data.paused, "SPP_PAUSED"
            assert sp.amount == self.data.mint_price, "SPP_WRONG_PRICE"
            assert sp.len(params.code) >= 8, "SPP_CODE_TOO_SHORT"
            assert sp.len(params.code) <= 520, "SPP_CODE_TOO_LONG"
            assert (
                sp.slice(0, 5, params.code).unwrap_some() == sp.bytes("0x535050312e")
            ), "SPP_NOT_A_TUNE"  # must start with "SPP1."
            assert sp.len(params.name) <= 80, "SPP_NAME_TOO_LONG"
            assert sp.len(params.attributes) <= 2500, "SPP_ATTRS_TOO_LONG"
            assert sp.len(params.description) <= 1600, "SPP_DESC_TOO_LONG"

            artifact_uri = self.data.base_uri + params.code
            # formats JSON: [{"uri":"<artifactUri>","mimeType":"text/html"}]
            formats = (
                sp.bytes("0x5b7b22757269223a22")  # [{"uri":"
                + artifact_uri
                + sp.bytes("0x222c226d696d6554797065223a22746578742f68746d6c227d5d")  # ","mimeType":"text/html"}]
            )

            token_info = {}
            for key_value in self.data.shared_info.items():
                token_info[key_value.key] = key_value.value
            token_info["name"] = params.name
            token_info["artifactUri"] = artifact_uri
            token_info["formats"] = formats
            token_info["attributes"] = params.attributes
            token_info["description"] = params.description
            token_info["tune"] = params.code

            token_id = self.data.next_token_id
            self.data.token_metadata[token_id] = sp.record(
                token_id=token_id, token_info=token_info
            )
            self.data.ledger[token_id] = sp.sender
            self.data.next_token_id += 1

        @sp.entrypoint
        def set_mint_price(self, mint_price):
            """(Admin only) Set the mint price for future mints."""
            assert self.is_administrator_(), "FA2_NOT_ADMIN"
            self.data.mint_price = sp.cast(mint_price, sp.mutez)

        @sp.entrypoint
        def set_paused(self, paused):
            """(Admin only) Pause or resume minting."""
            assert self.is_administrator_(), "FA2_NOT_ADMIN"
            self.data.paused = sp.cast(paused, sp.bool)

        @sp.entrypoint
        def set_base_uri(self, base_uri):
            """(Admin only) Set the canonical app base URI for future mints."""
            assert self.is_administrator_(), "FA2_NOT_ADMIN"
            self.data.base_uri = sp.cast(base_uri, sp.bytes)

        @sp.entrypoint
        def set_shared_info(self, shared_info):
            """(Admin only) Set the constant token_info entries for future mints."""
            assert self.is_administrator_(), "FA2_NOT_ADMIN"
            self.data.shared_info = sp.cast(shared_info, sp.map[sp.string, sp.bytes])


def utf8(s):
    return sp.bytes("0x" + s.encode("utf-8").hex())


# canonical test values (origination uses real values built at deploy time)
BASE = "https://example.com/superpepepaint/index.html?tune="
SHARED = {
    "decimals": utf8("0"),
    "symbol": utf8("SPPTUNE"),
    "displayUri": utf8("ipfs://placeholder-cover"),
    "thumbnailUri": utf8("ipfs://placeholder-cover"),
    "creators": utf8('["arwyn"]'),
    "royalties": utf8('{"decimals":3,"shares":{"tz1arwyn":100}}'),
    "tags": utf8('["superpepepaint","music","mariopaint","generative","pepe"]'),
}

GOOD_CODE = "SPP1.AVABAAAIRlhQQVJJVFkFAHBfAjFVA_RVBhBfB488Ug"


@sp.add_test()
def test():
    scenario = sp.test_scenario("superpepepaint_fa2", m)
    scenario.h1("SUPERPEPEPAINT sovereign mint")

    admin = sp.test_account("Admin")
    alice = sp.test_account("Alice")
    bob = sp.test_account("Bob")

    c = m.SuperPepePaint(
        administrator=admin.address,
        metadata=sp.big_map({"": utf8("tezos-storage:content"), "content": utf8("{}")}),
        mint_price=sp.mutez(500000),
        base_uri=utf8(BASE),
        shared_info=SHARED,
    )
    scenario += c

    scenario.h2("happy mint (genesis by admin, token 0)")
    c.mint(
        code=utf8(GOOD_CODE),
        name=utf8("GENESIS POND"),
        attributes=utf8('[{"name":"Source","value":"COMPOSED"}]'),
        description=utf8("The genesis tune."),
        _sender=admin,
        _amount=sp.mutez(500000),
    )
    scenario.verify(c.data.next_token_id == 1)
    scenario.verify(c.data.ledger[0] == admin.address)
    scenario.verify(
        c.data.token_metadata[0].token_info["artifactUri"]
        == utf8(BASE + GOOD_CODE)
    )
    scenario.verify(
        c.data.token_metadata[0].token_info["formats"]
        == utf8('[{"uri":"' + BASE + GOOD_CODE + '","mimeType":"text/html"}]')
    )
    scenario.verify(c.data.token_metadata[0].token_info["tune"] == utf8(GOOD_CODE))
    scenario.verify(c.data.token_metadata[0].token_info["decimals"] == utf8("0"))
    scenario.verify(c.data.token_metadata[0].token_info["name"] == utf8("GENESIS POND"))

    scenario.h2("collector mint (token 1)")
    c.mint(
        code=utf8(GOOD_CODE),
        name=utf8("ALICE BOP"),
        attributes=utf8('[{"name":"Source","value":"SEED"}]'),
        description=utf8("composed in the swamp"),
        _sender=alice,
        _amount=sp.mutez(500000),
    )
    scenario.verify(c.data.next_token_id == 2)
    scenario.verify(c.data.ledger[1] == alice.address)

    scenario.h2("wrong price rejected")
    c.mint(
        code=utf8(GOOD_CODE),
        name=utf8("CHEAPSKATE"),
        attributes=utf8("[]"),
        description=utf8(""),
        _sender=bob,
        _amount=sp.mutez(1),
        _valid=False,
        _exception="SPP_WRONG_PRICE",
    )

    scenario.h2("non-tune code rejected")
    c.mint(
        code=utf8("HELLO.WORLDxxxx"),
        name=utf8("JUNK"),
        attributes=utf8("[]"),
        description=utf8(""),
        _sender=bob,
        _amount=sp.mutez(500000),
        _valid=False,
        _exception="SPP_NOT_A_TUNE",
    )

    scenario.h2("oversize code rejected")
    c.mint(
        code=utf8("SPP1." + "A" * 600),
        name=utf8("TOO BIG"),
        attributes=utf8("[]"),
        description=utf8(""),
        _sender=bob,
        _amount=sp.mutez(500000),
        _valid=False,
        _exception="SPP_CODE_TOO_LONG",
    )

    scenario.h2("oversize name rejected")
    c.mint(
        code=utf8(GOOD_CODE),
        name=utf8("N" * 81),
        attributes=utf8("[]"),
        description=utf8(""),
        _sender=bob,
        _amount=sp.mutez(500000),
        _valid=False,
        _exception="SPP_NAME_TOO_LONG",
    )

    scenario.h2("pause blocks minting, unpause restores")
    c.set_paused(True, _sender=admin)
    c.mint(
        code=utf8(GOOD_CODE),
        name=utf8("WHILE PAUSED"),
        attributes=utf8("[]"),
        description=utf8(""),
        _sender=bob,
        _amount=sp.mutez(500000),
        _valid=False,
        _exception="SPP_PAUSED",
    )
    c.set_paused(False, _sender=admin)
    c.set_paused(True, _sender=bob, _valid=False, _exception="FA2_NOT_ADMIN")

    scenario.h2("price change applies to future mints")
    c.set_mint_price(sp.mutez(0), _sender=admin)
    c.set_mint_price(sp.mutez(0), _sender=bob, _valid=False, _exception="FA2_NOT_ADMIN")
    c.mint(
        code=utf8(GOOD_CODE),
        name=utf8("FREE MINT"),
        attributes=utf8("[]"),
        description=utf8(""),
        _sender=bob,
        _amount=sp.mutez(0),
    )
    scenario.verify(c.data.ledger[2] == bob.address)

    scenario.h2("base uri change applies to future mints")
    c.set_base_uri(utf8("ipfs://newbase?tune="), _sender=admin)
    c.set_base_uri(utf8("x"), _sender=bob, _valid=False, _exception="FA2_NOT_ADMIN")
    c.mint(
        code=utf8(GOOD_CODE),
        name=utf8("NEW BASE"),
        attributes=utf8("[]"),
        description=utf8(""),
        _sender=alice,
        _amount=sp.mutez(0),
    )
    scenario.verify(
        c.data.token_metadata[3].token_info["artifactUri"]
        == utf8("ipfs://newbase?tune=" + GOOD_CODE)
    )

    scenario.h2("FA2 transfer works")
    c.transfer(
        [
            sp.record(
                from_=alice.address,
                txs=[sp.record(to_=bob.address, token_id=1, amount=1)],
            )
        ],
        _sender=alice,
    )
    scenario.verify(c.data.ledger[1] == bob.address)

    scenario.h2("stranger cannot transfer someone else's token")
    c.transfer(
        [
            sp.record(
                from_=bob.address,
                txs=[sp.record(to_=alice.address, token_id=1, amount=1)],
            )
        ],
        _sender=alice,
        _valid=False,
        _exception="FA2_NOT_OPERATOR",
    )

    scenario.h2("withdraw proceeds")
    c.withdraw_mutez(
        destination=admin.address, amount=sp.mutez(1000000), _sender=admin
    )
    c.withdraw_mutez(
        destination=bob.address,
        amount=sp.mutez(1),
        _sender=bob,
        _valid=False,
        _exception="FA2_NOT_ADMIN",
    )

    scenario.h2("admin handoff")
    c.set_administrator(alice.address, _sender=admin)
    c.set_paused(True, _sender=alice)
    c.set_paused(False, _sender=alice)
    c.set_administrator(admin.address, _sender=alice)
